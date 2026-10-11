import { createHash } from "node:crypto";
import { Composio } from "@composio/core";
import { COMPOSIO_APP_CATALOG, type ComposioAppState } from "@nimbus/shared";
import type { JsonSchema, ToolDefinition } from "./types.js";

export interface OpenComposioInput {
  apiKey: string;
  userId: string;
  sessionId?: string;
  onSessionId?: (sessionId: string) => void;
}

interface OpenedSession {
  sessionId: string;
  session: {
    sessionId: string;
    execute(toolSlug: string, arguments_?: Record<string, unknown>, options?: undefined, requestOptions?: { signal?: AbortSignal }): Promise<{ data: Record<string, unknown>; error: string | null }>;
    authorize(toolkit: string): Promise<{ id: string; redirectUrl?: string | null }>;
    toolkits(options?: { toolkits?: string[]; isConnected?: boolean; search?: string; limit?: number; cursor?: string }): Promise<{
      items: { slug: string; name: string; isNoAuth: boolean; logo?: string; connection?: { isActive: boolean } }[];
      cursor?: string;
    }>;
  };
  composio: Composio;
}

const sessions = new Map<string, Promise<OpenedSession>>();

const READ_ONLY = new Set(["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_WAIT_FOR_CONNECTIONS"]);

const TITLES: Record<string, string> = {
  COMPOSIO_SEARCH_TOOLS: "search apps",
  COMPOSIO_MANAGE_CONNECTIONS: "connect app",
  COMPOSIO_MULTI_EXECUTE_TOOL: "run app action",
  COMPOSIO_REMOTE_WORKBENCH: "app workbench",
  COMPOSIO_REMOTE_BASH_TOOL: "app sandbox",
  COMPOSIO_GET_TOOL_SCHEMAS: "app tool schemas",
};

function cacheKey(apiKey: string, userId: string): string {
  return `${createHash("sha256").update(apiKey).digest("hex").slice(0, 16)}:${userId}`;
}

function redact(text: string, secret: string): string {
  return secret && text.includes(secret) ? text.split(secret).join("[redacted]") : text;
}

function asSchema(input: unknown): JsonSchema {
  if (!input || typeof input !== "object") return { type: "object", properties: {}, additionalProperties: true };
  const schema = input as { properties?: Record<string, unknown>; required?: unknown };
  const required = Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : undefined;
  return { type: "object", properties: schema.properties ?? {}, ...(required?.length ? { required } : {}) };
}

function summarize(args: Record<string, unknown>): string {
  const bits: string[] = [];
  for (const key of ["query", "use_case", "toolkit", "tool_slug", "toolkits"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) bits.push(value.trim());
    else if (Array.isArray(value) && value.length) bits.push(value.slice(0, 3).map(String).join(", "));
  }
  return bits.join(" · ").slice(0, 160);
}

async function createSession(input: OpenComposioInput): Promise<OpenedSession> {
  const composio = new Composio({ apiKey: input.apiKey, allowTracking: false, logLevel: "error" });
  const timeout = { signal: AbortSignal.timeout(25_000) };
  if (input.sessionId) {
    try {
      const session = await composio.sessions.use(input.sessionId, undefined, timeout);
      return { composio, session, sessionId: session.sessionId };
    } catch {
      // The saved session belongs to another key or has expired. Open a new one.
    }
  }
  const session = await composio.sessions.create(input.userId, { manageConnections: true }, timeout);
  return { composio, session, sessionId: session.sessionId };
}

/** Reuse one tool-router session per API key and user for this process. */
export async function openComposioSession(input: OpenComposioInput): Promise<OpenedSession> {
  const key = cacheKey(input.apiKey, input.userId);
  let pending = sessions.get(key);
  if (pending) {
    try {
      const opened = await pending;
      if (!input.sessionId || opened.sessionId === input.sessionId) {
        if (input.sessionId !== opened.sessionId) input.onSessionId?.(opened.sessionId);
        return opened;
      }
    } catch {
      if (sessions.get(key) === pending) sessions.delete(key);
      pending = undefined;
    }
  }
  const next = createSession(input);
  sessions.set(key, next);
  try {
    const opened = await next;
    if (input.sessionId !== opened.sessionId) input.onSessionId?.(opened.sessionId);
    return opened;
  } catch (error) {
    if (sessions.get(key) === next) sessions.delete(key);
    const message = redact(error instanceof Error ? error.message : String(error), input.apiKey);
    throw new Error(message);
  }
}

/** Register the session's meta tools. App actions are discovered at run time via search. */
export async function composioToolDefinitions(input: OpenComposioInput): Promise<ToolDefinition[]> {
  const opened = await openComposioSession(input);
  const raw = await opened.composio.tools.getRawToolRouterSessionTools(opened.sessionId, undefined, { signal: AbortSignal.timeout(20_000) });
  const meta = raw.filter((tool) => tool.slug.toUpperCase().startsWith("COMPOSIO_"));
  const chosen = (meta.length > 0 ? meta : raw).slice(0, 24);
  return chosen.map((tool) => {
    const slug = tool.slug;
    const readOnly = READ_ONLY.has(slug.toUpperCase());
    const description = (tool.description ?? tool.name ?? slug).slice(0, 12_000);
    return {
      id: slug,
      title: TITLES[slug.toUpperCase()] ?? tool.name ?? slug,
      category: "external" as const,
      source: "composio" as const,
      description,
      parameters: asSchema(tool.inputParameters),
      permission: "MCPTool" as const,
      readOnly,
      permissionSubject: () => slug,
      summarize,
      async execute(args, ctx) {
        try {
          const result = await opened.session.execute(slug, args ?? {}, undefined, { signal: ctx.signal });
          const payload = result.error ? { error: result.error, data: result.data } : result.data;
          const output = redact(JSON.stringify(payload, null, 2), input.apiKey);
          return { output: output && output !== "{}" ? output : "(empty result)", isError: Boolean(result.error), display: { kind: "generic" as const, text: output.slice(0, 4000) } };
        } catch (error) {
          const output = redact(error instanceof Error ? error.message : String(error), input.apiKey);
          return { output, isError: true };
        }
      },
    };
  });
}

interface ToolkitItem {
  slug: string;
  name: string;
  isNoAuth: boolean;
  logo?: string;
  connection?: { isActive: boolean };
}

function toApp(base: { slug: string; name: string; blurb: string }, item?: ToolkitItem): ComposioAppState {
  return {
    slug: item?.slug ?? base.slug,
    name: item?.name || base.name,
    blurb: base.blurb,
    logo: item?.logo,
    connected: Boolean(item?.connection?.isActive),
    noAuth: Boolean(item?.isNoAuth),
  };
}

interface CatalogApp {
  slug: string;
  name: string;
  blurb: string;
  logo?: string;
  category?: string;
  noAuth: boolean;
}

interface ToolkitPage {
  items?: Array<{
    slug?: string;
    name?: string;
    no_auth?: boolean;
    meta?: { description?: string; logo?: string; categories?: Array<{ name?: string }> };
  }>;
  next_cursor?: string | null;
}

const catalogCache = new Map<string, { at: number; items: CatalogApp[] }>();
const CATALOG_TTL_MS = 10 * 60_000;

function shorten(text: string | undefined): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "Connect this app";
  return clean.length > 96 ? `${clean.slice(0, 93)}…` : clean;
}

/** Every toolkit Composio can connect, paged past the 1,000-item cap. */
async function fetchToolkitCatalog(composio: Composio, apiKey: string): Promise<CatalogApp[]> {
  const key = cacheKey(apiKey, "catalog");
  const hit = catalogCache.get(key);
  if (hit && Date.now() - hit.at < CATALOG_TTL_MS) return hit.items;

  const client = composio.getClient();
  const items: CatalogApp[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = (await client.toolkits.list(
      { limit: 1000, sort_by: "alphabetically", cursor },
      { signal: AbortSignal.timeout(25_000) },
    )) as ToolkitPage;
    for (const item of result.items ?? []) {
      const slug = item.slug?.trim().toLowerCase();
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      items.push({
        slug,
        name: item.name?.trim() || slug,
        blurb: shorten(item.meta?.description),
        logo: item.meta?.logo,
        category: item.meta?.categories?.find((category) => category.name?.trim())?.name?.trim(),
        noAuth: Boolean(item.no_auth),
      });
    }
    const next = result.next_cursor?.trim();
    if (!next || next === cursor) break;
    cursor = next;
  }
  if (items.length === 0) throw new Error("Composio returned no apps");
  items.sort((a, b) => a.name.localeCompare(b.name));
  catalogCache.set(key, { at: Date.now(), items });
  return items;
}

async function fetchConnections(session: OpenedSession["session"]): Promise<Map<string, ToolkitItem>> {
  const bySlug = new Map<string, ToolkitItem>();
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await session.toolkits({ isConnected: true, limit: 50, cursor });
    for (const item of result.items) bySlug.set(item.slug.toLowerCase(), item);
    if (!result.cursor || result.cursor === cursor) break;
    cursor = result.cursor;
  }
  return bySlug;
}

/** The full Composio directory, with connection state for this space. */
export async function listComposioApps(input: OpenComposioInput): Promise<ComposioAppState[]> {
  try {
    const opened = await openComposioSession(input);
    const [catalog, connections] = await Promise.all([
      fetchToolkitCatalog(opened.composio, input.apiKey),
      fetchConnections(opened.session),
    ]);
    const seen = new Set<string>();
    const apps: ComposioAppState[] = catalog.map((app) => {
      seen.add(app.slug);
      const live = connections.get(app.slug);
      return {
        slug: app.slug,
        name: live?.name || app.name,
        blurb: app.blurb,
        logo: live?.logo || app.logo,
        category: app.category,
        connected: Boolean(live?.connection?.isActive),
        noAuth: app.noAuth || Boolean(live?.isNoAuth),
      };
    });
    for (const [slug, item] of connections) {
      if (seen.has(slug)) continue;
      apps.push(toApp({ slug, name: item.name, blurb: "Connected" }, item));
    }
    apps.sort((a, b) => Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name));
    return apps;
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error), input.apiKey);
    throw new Error(message);
  }
}

export async function connectComposioApp(input: OpenComposioInput, toolkit: string): Promise<{ redirectUrl: string | null }> {
  try {
    const opened = await openComposioSession(input);
    const request = await opened.session.authorize(toolkit);
    return { redirectUrl: request.redirectUrl ?? null };
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error), input.apiKey);
    throw new Error(message);
  }
}
