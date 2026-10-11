import { readSse, safeParseArgs, type LLMProvider, type ProviderEvent, type ProviderMessage, type StreamRequest } from "./types.js";

/**
 * OpenAI-compatible Chat Completions streaming. Works with xAI, OpenAI,
 * OpenRouter, Groq, Ollama (`/v1`), LM Studio, vLLM, etc.
 */
export class ChatCompletionsProvider implements LLMProvider {
  kind = "openai_compatible";
  hostedTools: string[] = [];

  constructor(private opts: { baseUrl: string; apiKey?: string; thinking?: boolean }) {}

  private toMessages(system: string, messages: ProviderMessage[]) {
    const out: unknown[] = [{ role: "system", content: system }];
    for (const m of messages) {
      if (m.role === "user") out.push({ role: "user", content: m.content });
      else if (m.role === "assistant") {
        out.push({
          role: "assistant",
          content: m.content || null,
          ...(this.opts.thinking ? { reasoning_content: m.reasoning ?? "" } : {}),
          tool_calls: m.toolCalls?.length
            ? m.toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args) } }))
            : undefined,
        });
      } else out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    }
    return out;
  }

  async *stream(req: StreamRequest): AsyncGenerator<ProviderEvent> {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: this.toMessages(req.system, req.messages),
      tools: req.tools.length ? req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) : undefined,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (this.opts.thinking) {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = "high";
    }
    let res: Response;
    try {
      res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}) },
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
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let finish: "stop" | "tool_calls" | "length" = "stop";
    for await (const { data } of readSse(res, req.signal)) {
      if (data === "[DONE]") break;
      let ev: any;
      try { ev = JSON.parse(data); } catch { continue; }
      if (ev.error) { yield { type: "error", message: ev.error.message ?? "Provider error" }; return; }
      if (ev.usage) yield { type: "usage", inputTokens: ev.usage.prompt_tokens ?? 0, outputTokens: ev.usage.completion_tokens ?? 0 };
      const choice = ev.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (typeof delta.content === "string" && delta.content) yield { type: "text", delta: delta.content };
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === "string" && reasoning) yield { type: "reasoning", delta: reasoning };
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const cur = calls.get(idx) ?? { id: tc.id ?? `call_${idx}_${Date.now().toString(36)}`, name: "", args: "" };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name += tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        calls.set(idx, cur);
      }
      if (choice.finish_reason === "tool_calls") finish = "tool_calls";
      else if (choice.finish_reason === "length") finish = "length";
    }
    for (const c of [...calls.values()]) {
      yield { type: "tool_call", id: c.id, name: c.name, args: safeParseArgs(c.args) };
    }
    yield { type: "done", finishReason: calls.size ? "tool_calls" : finish };
  }
}
