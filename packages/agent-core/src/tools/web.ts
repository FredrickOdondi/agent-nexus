import dns from "node:dns/promises";
import net from "node:net";
import { NodeHtmlMarkdown } from "node-html-markdown";
import type { SearchResult } from "@nimbus/shared";
import type { ToolDefinition } from "../types.js";
import { clampText } from "../util/fs.js";

const UA = "Mozilla/5.0 (compatible; NimbusAgent/0.1; +https://github.com)";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ");
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

async function braveSearch(query: string, count: number, apiKey: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, { headers: { Accept: "application/json", "X-Subscription-Token": apiKey } });
  if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);
  const data = (await res.json()) as { web?: { results?: { title: string; url: string; description: string }[] } };
  return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: stripTags(r.description ?? "") }));
}

async function duckDuckGoSearch(query: string, count: number, signal: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal,
  });
  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
  const html = await res.text();
  const results: SearchResult[] = [];
  const blocks = html.split(/class="result\s/).slice(1);
  for (const block of blocks) {
    const a = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/.exec(block);
    if (!a) continue;
    let href = decodeEntities(a[1]);
    const uddg = /[?&]uddg=([^&]+)/.exec(href);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) href = `https:${href}`;
    if (!/^https?:\/\//.test(href)) continue;
    results.push({ title: stripTags(a[2]), url: href, snippet: stripTags(snippet?.[1] ?? snippet?.[2] ?? "") });
    if (results.length >= count) break;
  }
  return results;
}

export const webSearch: ToolDefinition<{ query: string; count?: number }> = {
  id: "web_search",
  title: "web_search",
  category: "external",
  description: "Search the web. Returns titles, URLs and snippets. Follow up with web_fetch to read a page. Include the current year for time-sensitive queries.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string" },
      count: { type: "number", description: "Number of results (default 8, max 15)." },
    },
    required: ["query"],
  },
  permission: null,
  readOnly: true,
  summarize: (a) => a.query,
  async execute(args, ctx) {
    if (!ctx.session.settings.webSearchEnabled) return { output: "Web search is disabled in settings.", isError: true };
    const count = Math.min(Math.max(args.count ?? 8, 1), 15);
    try {
      const brave = process.env.BRAVE_API_KEY;
      const results = brave ? await braveSearch(args.query, count, brave) : await duckDuckGoSearch(args.query, count, ctx.signal);
      if (results.length === 0) return { output: "No results.", display: { kind: "search", query: args.query, results } };
      const text = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
      return { output: text, display: { kind: "search", query: args.query, results } };
    } catch (e) {
      return { output: `Search failed: ${(e as Error).message}`, isError: true };
    }
  },
};

const PRIVATE_RANGES = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^::1$/, /^fc/i, /^fd/i, /^fe80/i];

async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Refusing to fetch private host");
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  for (const ip of ips) if (PRIVATE_RANGES.some((r) => r.test(ip))) throw new Error(`Refusing to fetch private address ${ip}`);
}

const nhm = new NodeHtmlMarkdown({ ignore: ["script", "style", "nav", "footer", "iframe", "noscript", "svg"], keepDataImages: false });

export const webFetch: ToolDefinition<{ url: string; max_chars?: number }> = {
  id: "web_fetch",
  title: "web_fetch",
  category: "external",
  description: "Fetch a public URL and return its content as Markdown (HTML is converted; JSON/text returned as-is). Private/loopback hosts are blocked. Content is capped at max_chars (default 20000).",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string" },
      max_chars: { type: "number" },
    },
    required: ["url"],
  },
  permission: "WebFetch",
  readOnly: true,
  summarize: (a) => a.url,
  permissionSubject: (a) => a.url,
  async execute(args, ctx) {
    let url: URL;
    try {
      url = new URL(args.url);
      if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) URLs are supported");
      await assertPublicHost(url);
    } catch (e) {
      return { output: `Invalid URL: ${(e as Error).message}`, isError: true };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const onAbort = () => controller.abort();
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/markdown, text/html;q=0.9, application/json;q=0.8, text/plain;q=0.7, */*;q=0.5" }, redirect: "follow", signal: controller.signal });
      if (!res.ok) return { output: `HTTP ${res.status} ${res.statusText} for ${args.url}`, isError: true };
      const type = res.headers.get("content-type") ?? "";
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            size += value.length;
            if (size > 3_000_000) { reader.cancel().catch(() => {}); break; }
          }
        }
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      let title = url.hostname;
      let text: string;
      if (type.includes("html")) {
        title = stripTags(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] ?? title);
        const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(raw)?.[1] ?? raw;
        const main = /<(main|article)[^>]*>([\s\S]*?)<\/\1>/i.exec(body)?.[2] ?? body;
        text = nhm.translate(main).replace(/\n{3,}/g, "\n\n").trim();
      } else {
        text = raw;
      }
      const max = Math.min(Math.max(args.max_chars ?? 20_000, 500), 100_000);
      const clipped = clampText(text, max);
      return { output: `# ${title}\nSource: ${args.url}\n\n${clipped}`, display: { kind: "fetch", url: args.url, title, excerpt: clampText(text, 600) } };
    } catch (e) {
      return { output: `Fetch failed: ${(e as Error).message}`, isError: true };
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
    }
  },
};
