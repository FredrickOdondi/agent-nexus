import type { McpServerConfig } from "@nimbus/shared";
import type { ToolDefinition } from "./types.js";
import { clampText } from "./util/fs.js";

/**
 * Dynamic MCP registration. Each enabled server is connected lazily and its
 * tools are exposed to the model as `mcp__<server>__<tool>`, gated by the
 * MCPTool(...) permission class — the same shape Grok Build uses.
 */
export class McpManager {
  private clients = new Map<string, { client: any; tools: ToolDefinition<any>[] }>();

  async connect(cfg: McpServerConfig, log: (msg: string) => void): Promise<ToolDefinition<any>[]> {
    const existing = this.clients.get(cfg.id);
    if (existing) return existing.tools;
    try {
      const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
      const client = new Client({ name: "nimbus", version: "0.1.0" });
      if (cfg.transport === "stdio") {
        const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
        if (!cfg.command) throw new Error("stdio transport requires a command");
        await client.connect(new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], stderr: "ignore" }));
      } else {
        const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        if (!cfg.url) throw new Error("http transport requires a url");
        await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url)));
      }
      const listed = await client.listTools();
      const slug = cfg.name.replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
      const tools: ToolDefinition<any>[] = listed.tools.map((t: any) => ({
        id: `mcp__${slug}__${t.name}`,
        title: `${cfg.name}.${t.name}`,
        category: "external" as const,
        description: `[MCP ${cfg.name}] ${t.description ?? ""}`.trim(),
        parameters: normaliseSchema(t.inputSchema),
        permission: "MCPTool" as const,
        readOnly: Boolean(t.annotations?.readOnlyHint),
        summarize: () => `${cfg.name}.${t.name}`,
        permissionSubject: () => `${slug}.${t.name}`,
        async execute(args: Record<string, unknown>) {
          const res = await client.callTool({ name: t.name, arguments: args });
          const content = Array.isArray(res.content) ? res.content : [];
          const text = content
            .map((c: any) => (c.type === "text" ? c.text : c.type === "image" ? `[image ${c.mimeType}]` : JSON.stringify(c)))
            .join("\n");
          return { output: clampText(text || JSON.stringify(res.structuredContent ?? {}), 30_000), isError: Boolean(res.isError) };
        },
      }));
      this.clients.set(cfg.id, { client, tools });
      log(`MCP ${cfg.name}: ${tools.length} tools`);
      return tools;
    } catch (e) {
      log(`MCP ${cfg.name} failed: ${(e as Error).message}`);
      return [];
    }
  }

  async disconnect(id: string) {
    const c = this.clients.get(id);
    if (!c) return;
    this.clients.delete(id);
    await c.client.close().catch(() => {});
  }

  async closeAll() {
    for (const id of [...this.clients.keys()]) await this.disconnect(id);
  }
}

function normaliseSchema(schema: any): ToolDefinition["parameters"] {
  if (schema && schema.type === "object") return { type: "object", properties: schema.properties ?? {}, required: schema.required };
  return { type: "object", properties: {} };
}
