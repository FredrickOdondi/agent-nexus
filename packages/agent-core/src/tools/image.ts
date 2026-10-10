import type { ToolDefinition } from "../types.js";

/**
 * Image generation through the configured provider's OpenAI-compatible
 * `/images/generations` endpoint (xAI: grok-2-image / grok-imagine).
 */
export const imageGen: ToolDefinition<{ prompt: string; n?: number }> = {
  id: "image_gen",
  title: "image_gen",
  category: "external",
  description: "Generate an image from a text prompt using the configured provider. Returns an image URL that is rendered inline.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string" },
      n: { type: "number", description: "Number of images (1-4). Default 1." },
    },
    required: ["prompt"],
  },
  permission: null,
  readOnly: true,
  summarize: (a) => a.prompt,
  async execute(args, ctx) {
    const provider = ctx.session.settings.provider;
    if (provider.kind === "mock" || !provider.apiKey) {
      const seed = encodeURIComponent(args.prompt.slice(0, 40));
      const url = `https://picsum.photos/seed/${seed}/768/512`;
      return {
        output: `Generated placeholder image (configure an xAI/OpenAI key for real generations): ${url}`,
        display: { kind: "image", url, prompt: args.prompt },
        parts: [{ type: "image", url, alt: args.prompt }],
      };
    }
    const model = provider.kind === "xai" ? "grok-2-image" : "dall-e-3";
    const res = await fetch(`${provider.baseUrl.replace(/\/$/, "")}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({ model, prompt: args.prompt, n: Math.min(Math.max(args.n ?? 1, 1), 4), response_format: "url" }),
      signal: ctx.signal,
    });
    if (!res.ok) return { output: `Image generation failed: HTTP ${res.status} ${await res.text()}`, isError: true };
    const data = (await res.json()) as { data: { url: string; revised_prompt?: string }[] };
    const urls = data.data.map((d) => d.url);
    return {
      output: `Generated ${urls.length} image(s):\n${urls.join("\n")}`,
      display: { kind: "image", url: urls[0], prompt: args.prompt },
      parts: urls.map((url) => ({ type: "image" as const, url, alt: args.prompt })),
    };
  },
};
