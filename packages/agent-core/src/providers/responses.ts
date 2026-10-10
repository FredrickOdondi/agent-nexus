import type { Citation } from "@nimbus/shared";
import { readSse, safeParseArgs, type LLMProvider, type ProviderEvent, type ProviderMessage, type StreamRequest } from "./types.js";

export interface ResponsesProviderOptions {
  baseUrl: string;
  apiKey: string;
  /** Attach xAI's server-side agent tools (web_search, x_search, code_interpreter). */
  hostedTools: boolean;
  kind: "xai" | "openai";
}

/**
 * OpenAI-style Responses API, which xAI implements at https://api.x.ai/v1/responses.
 * Server-side tools (xAI Agent Tools API) run inside the request; function
 * tools come back as `function_call` items for local execution.
 */
export class ResponsesProvider implements LLMProvider {
  kind: string;
  hostedTools: string[];

  constructor(private opts: ResponsesProviderOptions) {
    this.kind = opts.kind;
    this.hostedTools = opts.hostedTools && opts.kind === "xai" ? ["web_search", "x_search", "code_execution"] : [];
  }

  private toInput(messages: ProviderMessage[]) {
    const input: unknown[] = [];
    for (const m of messages) {
      if (m.role === "user") input.push({ role: "user", content: m.content });
      else if (m.role === "assistant") {
        if (m.content) input.push({ role: "assistant", content: m.content });
        for (const tc of m.toolCalls ?? []) input.push({ type: "function_call", call_id: tc.id, name: tc.name, arguments: JSON.stringify(tc.args) });
      } else input.push({ type: "function_call_output", call_id: m.toolCallId, output: m.content });
    }
    return input;
  }

  async *stream(req: StreamRequest): AsyncGenerator<ProviderEvent> {
    const tools: unknown[] = req.tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.parameters, strict: false }));
    if (this.hostedTools.length) {
      tools.push({ type: "web_search" }, { type: "x_search" }, { type: "code_interpreter" });
    }
    const body = {
      model: req.model,
      instructions: req.system,
      input: this.toInput(req.messages),
      tools,
      stream: true,
      store: false,
      parallel_tool_calls: true,
      include: this.hostedTools.length ? ["web_search_call.action.sources", "code_interpreter_call.outputs"] : undefined,
    };
    let res: Response;
    try {
      res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.opts.apiKey}` },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (e) {
      yield { type: "error", message: `Network error: ${(e as Error).message}` };
      return;
    }
    if (!res.ok || !res.body) {
      yield { type: "error", message: `Provider error ${res.status}: ${(await res.text()).slice(0, 800)}` };
      return;
    }

    const pendingCalls = new Map<string, { callId: string; name: string; args: string }>();
    const citations: Citation[] = [];
    let sawToolCall = false;

    for await (const { data } of readSse(res, req.signal)) {
      if (data === "[DONE]") break;
      let ev: any;
      try { ev = JSON.parse(data); } catch { continue; }
      const t: string = ev.type ?? "";
      switch (t) {
        case "response.output_text.delta":
          if (ev.delta) yield { type: "text", delta: ev.delta };
          break;
        case "response.reasoning_summary_text.delta":
        case "response.reasoning_text.delta":
          if (ev.delta) yield { type: "reasoning", delta: ev.delta };
          break;
        case "response.output_item.added": {
          const item = ev.item ?? {};
          if (item.type === "function_call") {
            pendingCalls.set(item.id, { callId: item.call_id ?? item.id, name: item.name, args: item.arguments ?? "" });
          } else if (/^(web_search_call|code_interpreter_call|custom_tool_call|file_search_call|mcp_call)$/.test(item.type)) {
            yield { type: "server_tool", id: item.id, name: hostedName(item), status: "running", summary: hostedSummary(item) };
          }
          break;
        }
        case "response.function_call_arguments.delta": {
          const p = pendingCalls.get(ev.item_id);
          if (p) p.args += ev.delta ?? "";
          break;
        }
        case "response.function_call_arguments.done": {
          const p = pendingCalls.get(ev.item_id);
          if (p && ev.arguments) p.args = ev.arguments;
          break;
        }
        case "response.output_item.done": {
          const item = ev.item ?? {};
          if (item.type === "function_call") {
            const p = pendingCalls.get(item.id) ?? { callId: item.call_id ?? item.id, name: item.name, args: item.arguments ?? "" };
            pendingCalls.delete(item.id);
            sawToolCall = true;
            yield { type: "tool_call", id: p.callId, name: p.name, args: safeParseArgs(item.arguments ?? p.args) };
          } else if (/^(web_search_call|code_interpreter_call|custom_tool_call|file_search_call|mcp_call)$/.test(item.type)) {
            yield { type: "server_tool", id: item.id, name: hostedName(item), status: "complete", summary: hostedSummary(item) };
          }
          break;
        }
        case "response.output_text.annotation.added": {
          const a = ev.annotation ?? {};
          if (a.type === "url_citation" && a.url) citations.push({ url: a.url, title: a.title ?? a.url });
          break;
        }
        case "response.completed": {
          const r = ev.response ?? {};
          if (Array.isArray(r.citations)) for (const c of r.citations) if (typeof c === "string") citations.push({ url: c, title: c });
          if (r.usage) yield { type: "usage", inputTokens: r.usage.input_tokens ?? 0, outputTokens: r.usage.output_tokens ?? 0 };
          break;
        }
        case "response.failed":
        case "error":
          yield { type: "error", message: ev.error?.message ?? ev.response?.error?.message ?? "Provider reported an error" };
          return;
        default:
          break;
      }
    }
    if (citations.length) {
      const unique = [...new Map(citations.map((c) => [c.url, c])).values()];
      yield { type: "citations", citations: unique };
    }
    yield { type: "done", finishReason: sawToolCall ? "tool_calls" : "stop" };
  }
}

function hostedName(item: any): string {
  switch (item.type) {
    case "web_search_call": return "web_search";
    case "code_interpreter_call": return "code_execution";
    case "file_search_call": return "collections_search";
    case "mcp_call": return item.name ? `mcp:${item.name}` : "mcp";
    case "custom_tool_call": return String(item.call_id ?? "").startsWith("as_") ? "attachment_search" : "x_search";
    default: return String(item.type);
  }
}

function hostedSummary(item: any): string | undefined {
  const q = item.action?.query ?? item.input ?? item.arguments;
  if (typeof q === "string") return q.slice(0, 200);
  if (item.code) return String(item.code).slice(0, 200);
  return undefined;
}
