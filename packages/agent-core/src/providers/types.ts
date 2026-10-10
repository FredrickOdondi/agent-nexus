import type { Citation } from "@nimbus/shared";
import type { JsonSchema } from "../types.js";

export type ProviderMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: { id: string; name: string; args: Record<string, unknown> }[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface ProviderToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export type ProviderEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "server_tool"; id: string; name: string; status: "running" | "complete"; summary?: string }
  | { type: "citations"; citations: Citation[] }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "length" | "error" }
  | { type: "error"; message: string };

export interface StreamRequest {
  system: string;
  messages: ProviderMessage[];
  tools: ProviderToolSpec[];
  model: string;
  signal: AbortSignal;
}

export interface LLMProvider {
  kind: string;
  /** Names of tools executed by the provider (xAI Agent Tools). */
  hostedTools: string[];
  stream(req: StreamRequest): AsyncGenerator<ProviderEvent>;
}

/** Minimal SSE reader over fetch streams. */
export async function* readSse(res: Response, signal: AbortSignal): AsyncGenerator<{ event?: string; data: string }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const onAbort = () => reader.cancel().catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event: string | undefined;
        const dataLines: string[] = [];
        for (const line of chunk.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length) yield { event, data: dataLines.join("\n") };
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function safeParseArgs(raw: string | undefined | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return { _raw: raw };
  }
}
