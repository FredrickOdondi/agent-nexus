import type { LLMProvider, ProviderEvent, ProviderMessage, StreamRequest } from "./types.js";

/**
 * Offline demo provider. Produces realistic streamed answers and exercises the
 * tool loop (list_dir, grep, read_file, web_search, todo_write, image_gen…) so
 * the whole product works before an API key is configured.
 */
export class MockProvider implements LLMProvider {
  kind = "mock";
  hostedTools: string[] = [];

  async *stream(req: StreamRequest): AsyncGenerator<ProviderEvent> {
    const last = req.messages[req.messages.length - 1];
    const lastUser = [...req.messages].reverse().find((m): m is Extract<ProviderMessage, { role: "user" }> => m.role === "user");
    const text = lastUser?.content ?? "";
    const toolNames = new Set(req.tools.map((t) => t.name));

    if (last?.role === "tool") {
      yield* this.summariseTools(req.messages, req.signal);
      return;
    }

    const lower = text.toLowerCase();
    const wantsTool = (n: string) => toolNames.has(n);
    const id = () => `call_${Math.random().toString(36).slice(2, 10)}`;

    if (/\b(explore|codebase|structure|what files|list files|project layout)\b/.test(lower) && wantsTool("list_dir")) {
      yield* this.say("I'll take a look at the workspace layout first.", req.signal);
      yield { type: "tool_call", id: id(), name: "list_dir", args: { path: ".", depth: 2 } };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }
    if (/\b(search the web|latest|news|look up|google|what's new|whats new)\b/.test(lower) && wantsTool("web_search")) {
      yield* this.say("Let me search for current information.", req.signal);
      yield { type: "tool_call", id: id(), name: "web_search", args: { query: text.replace(/search the web for|look up/gi, "").trim().slice(0, 120), count: 6 } };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }
    if (/\b(find|grep|where is|which file|search (for|the) code)\b/.test(lower) && wantsTool("grep")) {
      const m = /["'`]([^"'`]+)["'`]/.exec(text);
      yield { type: "tool_call", id: id(), name: "grep", args: { pattern: m?.[1] ?? text.split(/\s+/).slice(-1)[0], max_results: 40 } };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }
    if (/\b(image|picture|draw|illustration|logo)\b/.test(lower) && wantsTool("image_gen")) {
      yield* this.say("Generating that image now.", req.signal);
      yield { type: "tool_call", id: id(), name: "image_gen", args: { prompt: text } };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }
    if (/\b(plan|roadmap|steps|how (would|should) (you|we)|break (this|it) down)\b/.test(lower) && wantsTool("todo_write")) {
      yield* this.say("Here's how I'd break this down.", req.signal);
      yield {
        type: "tool_call",
        id: id(),
        name: "todo_write",
        args: {
          todos: [
            { id: "1", content: "Clarify requirements and constraints", status: "completed" },
            { id: "2", content: "Explore the relevant code and dependencies", status: "in_progress" },
            { id: "3", content: "Implement the change behind a small, testable interface", status: "pending" },
            { id: "4", content: "Add verification (tests, build, manual check)", status: "pending" },
            { id: "5", content: "Document and ship", status: "pending" },
          ],
        },
      };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }
    if (/\b(should i|which (one|option)|prefer|choose|pick)\b/.test(lower) && wantsTool("ask_user_question")) {
      yield {
        type: "tool_call",
        id: id(),
        name: "ask_user_question",
        args: {
          question: "Which direction should I take?",
          options: [
            { label: "Fast and simple", description: "Minimal change, ship today" },
            { label: "Robust", description: "More structure, tests and docs" },
            { label: "Explore first", description: "Research options before deciding" },
          ],
          allow_freeform: true,
        },
      };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }

    const reply = buildReply(text);
    yield { type: "reasoning", delta: "Reading the request, deciding whether tools are needed… a direct answer is best here." };
    yield* this.say(reply, req.signal);
    yield { type: "usage", inputTokens: Math.round(text.length / 4) + 400, outputTokens: Math.round(reply.length / 4) };
    yield { type: "done", finishReason: "stop" };
  }

  private async *summariseTools(messages: ProviderMessage[], signal: AbortSignal): AsyncGenerator<ProviderEvent> {
    const results = [] as Extract<ProviderMessage, { role: "tool" }>[];
    for (let i = messages.length - 1; i >= 0 && messages[i].role === "tool"; i--) results.unshift(messages[i] as any);
    const lines: string[] = [];
    for (const r of results) {
      const preview = r.content.split("\n").filter(Boolean).slice(0, 8).join("\n");
      switch (r.name) {
        case "list_dir":
          lines.push(`Here's the top of the workspace tree:\n\n\`\`\`\n${preview}\n\`\`\`\n\nTell me which area you'd like me to dig into and I'll read the relevant files.`);
          break;
        case "web_search":
          lines.push(`Here's what I found:\n\n${r.content.split("\n\n").slice(0, 4).map((b) => `- ${b.split("\n")[0].replace(/^\d+\.\s*/, "**")}**\n  ${b.split("\n").slice(1).join(" ").trim()}`).join("\n")}\n\nWant me to open one of these and summarise it?`);
          break;
        case "grep":
          lines.push(r.content === "No matches." ? "I didn't find any matches for that pattern. Try a different term or let me widen the search." : `Matches:\n\n\`\`\`\n${preview}\n\`\`\``);
          break;
        case "image_gen":
          lines.push("Here's the generated image. Configure an xAI key in Settings to use grok-imagine for real generations.");
          break;
        case "todo_write":
          lines.push("I've laid out the plan above. Say **go** and I'll start on the first item, or adjust any step.");
          break;
        case "ask_user_question":
          lines.push(`Great — going with **${r.content.replace("User answered: ", "")}**. Here's how I'd proceed:\n\n1. Scope the change precisely\n2. Make the smallest working slice\n3. Verify it end-to-end\n4. Iterate on polish`);
          break;
        default:
          lines.push(`Done. ${preview}`);
      }
    }
    yield* this.say(lines.join("\n\n"), signal);
    yield { type: "done", finishReason: "stop" };
  }

  private async *say(text: string, signal: AbortSignal): AsyncGenerator<ProviderEvent> {
    const tokens = text.match(/\S+\s*|\s+/g) ?? [text];
    for (const t of tokens) {
      if (signal.aborted) return;
      yield { type: "text", delta: t };
      await new Promise((r) => setTimeout(r, 8 + Math.random() * 18));
    }
  }
}

function buildReply(text: string): string {
  const t = text.trim();
  if (!t) return "Say something and I'll help.";
  if (/^(hi|hello|hey|yo)\b/i.test(t)) {
    return "Hey! I'm **Nimbus**, running in offline demo mode.\n\nI can explore your workspace, search the web, edit files, run commands and plan work. Add a DeepSeek API key in **Settings → Model** to unlock the real model.\n\nTry:\n- *Explore the codebase*\n- *Search the web for the latest TypeScript release*\n- *Plan a migration from Next.js to Vite*";
  }
  if (/\?$/.test(t)) {
    return `Good question. In demo mode I can't reason about *"${t.slice(0, 80)}"* with a real model yet, but here's how I'd approach it:\n\n1. **Clarify** the exact outcome you want.\n2. **Gather context** — I'd read the relevant files or search the web.\n3. **Propose** a concrete answer with sources or code.\n\nConnect a model in Settings and ask again — I'll do all of this for real, with citations.`;
  }
  return `Got it: *"${t.slice(0, 120)}"*.\n\nI'm in **offline demo mode**, so this reply is scripted — but every other part of the product is real: your messages are persisted, synced to all linked devices, and the agent tool loop (shell, files, grep, web search, subagents, memory) is wired up.\n\nOpen **Settings → Model**, paste a DeepSeek API key, and I'll pick this up with the real model.`;
}
