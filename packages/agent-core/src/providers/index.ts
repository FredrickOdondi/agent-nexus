import type { ProviderSettings } from "@nimbus/shared";
import { ChatCompletionsProvider } from "./chat.js";
import { MockProvider } from "./mock.js";
import { ResponsesProvider } from "./responses.js";
import type { LLMProvider } from "./types.js";

export * from "./types.js";
export { ChatCompletionsProvider, MockProvider, ResponsesProvider };

export const DEFAULT_MODELS: Record<ProviderSettings["kind"], { baseUrl: string; model: string; suggestions: string[] }> = {
  xai: { baseUrl: "https://api.x.ai/v1", model: "grok-4-1-fast-reasoning", suggestions: ["grok-4-1-fast-reasoning", "grok-4-1-fast-non-reasoning", "grok-4", "grok-3-mini"] },
  openai_compatible: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", suggestions: ["gpt-4.1-mini", "gpt-4.1", "o4-mini", "llama3.1", "qwen2.5-coder"] },
  mock: { baseUrl: "", model: "nimbus-demo", suggestions: ["nimbus-demo"] },
};

export function createProvider(settings: ProviderSettings): LLMProvider {
  if (settings.kind === "mock" || !settings.apiKey && settings.kind === "xai") return new MockProvider();
  if (settings.kind === "xai") {
    return new ResponsesProvider({ baseUrl: settings.baseUrl || DEFAULT_MODELS.xai.baseUrl, apiKey: settings.apiKey!, hostedTools: settings.serverTools, kind: "xai" });
  }
  return new ChatCompletionsProvider({ baseUrl: settings.baseUrl || DEFAULT_MODELS.openai_compatible.baseUrl, apiKey: settings.apiKey });
}
