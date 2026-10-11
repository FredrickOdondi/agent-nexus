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
    toolkits(options?: { toolkits?: string[]; isConnected?: boolean; search?: string; limit?: number }): Promise<{
      items: { slug: string; name: string; isNoAuth: boolean; logo?: string; connection?: { isActive: boolean } }[];
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

/** Connection state for the settings catalog, plus any other apps already connected. */
export async function listComposioApps(input: OpenComposioInput): Promise<ComposioAppState[]> {
  try {
    const opened = await openComposioSession(input);
    const slugs = COMPOSIO_APP_CATALOG.map((app) => app.slug);
    const [known, connected] = await Promise.all([
      opened.session.toolkits({ toolkits: slugs, limit: slugs.length }),
      opened.session.toolkits({ isConnected: true, limit: 50 }),
    ]);
    const bySlug = new Map<string, ToolkitItem>();
    for (const item of [...known.items, ...connected.items]) bySlug.set(item.slug.toLowerCase(), item);
    const seen = new Set<string>();
    const apps = COMPOSIO_APP_CATALOG.map((app) => {
      seen.add(app.slug);
      return toApp(app, bySlug.get(app.slug));
    });
    for (const item of connected.items) {
      const slug = item.slug.toLowerCase();
      if (seen.has(slug)) continue;
      seen.add(slug);
      apps.push(toApp({ slug, name: item.name, blurb: "Connected" }, item));
    }
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
