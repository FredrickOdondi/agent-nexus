import type { ProviderSettings } from "@nimbus/shared";
import { ChatCompletionsProvider } from "./chat.js";
import { MockProvider } from "./mock.js";
import { ResponsesProvider } from "./responses.js";
import type { LLMProvider } from "./types.js";

export * from "./types.js";
export { ChatCompletionsProvider, MockProvider, ResponsesProvider };

export const DEFAULT_MODELS: Record<ProviderSettings["kind"], { baseUrl: string; model: string; suggestions: string[] }> = {
  deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-pro", suggestions: ["deepseek-v4-pro", "deepseek-flash"] },
  xai: { baseUrl: "https://api.x.ai/v1", model: "grok-4-1-fast-reasoning", suggestions: ["grok-4-1-fast-reasoning", "grok-4-1-fast-non-reasoning", "grok-4", "grok-3-mini"] },
  openai_compatible: { baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini", suggestions: ["gpt-4.1-mini", "gpt-4.1", "o4-mini", "llama3.1", "qwen2.5-coder"] },
  mock: { baseUrl: "", model: "nimbus-demo", suggestions: ["nimbus-demo"] },
};

/** A saved key wins. DeepSeek also accepts DEEPSEEK_API_KEY from the environment. */
export function resolveProviderApiKey(settings: ProviderSettings): string | undefined {
  if (settings.apiKey) return settings.apiKey;
  if (settings.kind === "deepseek" && process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  return undefined;
}

export function createProvider(settings: ProviderSettings): LLMProvider {
  const apiKey = resolveProviderApiKey(settings);
  if (settings.kind === "mock" || !apiKey && (settings.kind === "xai" || settings.kind === "deepseek")) return new MockProvider();
  if (settings.kind === "xai") {
    return new ResponsesProvider({ baseUrl: settings.baseUrl || DEFAULT_MODELS.xai.baseUrl, apiKey: apiKey!, hostedTools: settings.serverTools, kind: "xai" });
  }
  if (settings.kind === "deepseek") {
    return new ChatCompletionsProvider({ baseUrl: settings.baseUrl || DEFAULT_MODELS.deepseek.baseUrl, apiKey, thinking: true });
  }
  return new ChatCompletionsProvider({ baseUrl: settings.baseUrl || DEFAULT_MODELS.openai_compatible.baseUrl, apiKey });
}
