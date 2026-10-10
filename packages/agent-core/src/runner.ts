import os from "node:os";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Citation, Message, Part, ProviderSettings, QuestionOption, TodoItem, ToolCallPart, ToolDisplay } from "@nimbus/shared";
import { newId } from "@nimbus/shared";
import { createMemoryStore, createSkillCatalog, loadProjectRules } from "./discovery.js";
import { discoverHooks, runHooks } from "./hooks.js";
import { McpManager } from "./mcp.js";
import { evaluatePermission } from "./permissions.js";
import { renderSystemPrompt } from "./prompt.js";
import { createProvider, type LLMProvider, type ProviderMessage, type ProviderToolSpec } from "./providers/index.js";
import { ToolRegistry } from "./registry.js";
import { createProcessManager } from "./tools/terminal.js";
import type {
  ApprovalAnswer,
  ApprovalPrompt,
  HookDefinition,
  PermissionConfig,
  SessionServices,
  TaskManager,
  TaskRecord,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from "./types.js";
import { clampText, exists } from "./util/fs.js";

export type Profile = "main" | "explore" | "general" | "plan" | "review";

/** Host-provided UI/persistence bridge for one run. */
export interface RunSink {
  appendText(delta: string): void;
  appendReasoning(delta: string): void;
  addPart(part: Part): number;
  updatePart(index: number, part: Part): void;
  toolProgress(index: number, chunk: string): void;
  status(state: "thinking" | "tool" | "waiting_user", detail?: string): void;
  askUser(question: string, options: QuestionOption[], allowFreeform: boolean): Promise<string>;
  requestApproval(prompt: ApprovalPrompt): Promise<ApprovalAnswer>;
  setTodos(todos: TodoItem[]): void;
  setUsage(usage: { inputTokens: number; outputTokens: number }): void;
  log(level: "info" | "warn" | "error", msg: string, extra?: unknown): void;
}

export interface RunOptions {
  conversationId: string;
  cwd: string;
  dataDir: string;
  mode: "agent" | "plan" | "chat";
  profile?: Profile;
  provider: ProviderSettings;
  permission: { mode: PermissionConfig["mode"]; allow: string[]; deny: string[] };
  settings: { webSearchEnabled: boolean; subagentsEnabled: boolean; memoryEnabled: boolean; mcpServers: { id: string; name: string; transport: "stdio" | "http"; command?: string; args?: string[]; url?: string; enabled: boolean }[]; systemPromptAddendum: string };
  history: Message[];
  signal: AbortSignal;
  maxTurns?: number;
  platformName?: string;
  /** Shared across runs in one process so MCP connections are reused. */
  mcp?: McpManager;
  /** Shared "allow always" grants for this conversation. */
  sessionAllow?: Set<string>;
}

export interface RunOutcome {
  status: "complete" | "error" | "cancelled";
  text: string;
  toolCalls: number;
  turns: number;
  error?: string;
}

const MAX_HISTORY_CHARS = 350_000;

export class AgentRunner {
  private registry = new ToolRegistry();
  private tools: ToolDefinition<any>[] = [];
  private provider!: LLMProvider;
  private hooks: HookDefinition[] = [];
  private todos: TodoItem[] = [];
  private planActive = false;
  private sessionAllow: Set<string>;
  private processes = createProcessManager();
  private tasks: TaskRecord[] = [];
  private taskWaiters = new Map<string, Promise<void>>();

  constructor(private opts: RunOptions, private sink: RunSink) {
    this.sessionAllow = opts.sessionAllow ?? new Set();
    this.planActive = opts.mode === "plan";
  }

  get workspaceRoot() {
    return this.opts.cwd;
  }

  private permissionConfig(): PermissionConfig {
    return {
      mode: this.planActive ? "plan" : this.opts.permission.mode,
      allow: this.opts.permission.allow,
      deny: this.opts.permission.deny,
      sessionAllow: this.sessionAllow,
    };
  }

  private buildServices(): SessionServices {
    const memory = createMemoryStore(this.opts.dataDir, this.opts.cwd);
    const skills = createSkillCatalog(this.opts.cwd);
    const checkpointDir = path.join(this.opts.dataDir, "checkpoints", this.opts.conversationId);
    const self = this;
    return {
      askUser: (q, o, f) => { this.sink.status("waiting_user", q); return this.sink.askUser(q, o, f); },
      requestApproval: (p) => { this.sink.status("waiting_user", p.summary); return this.sink.requestApproval(p); },
      setTodos: (t) => { this.todos = t; this.sink.setTodos(t); },
      getTodos: () => this.todos,
      memory,
      skills,
      processes: this.processes,
      tasks: this.taskManager(),
      planMode: {
        get active() { return self.planActive; },
        enter() { self.planActive = true; },
        async exit(plan: string) {
          const answer = await self.sink.askUser(`Approve this plan?\n\n${plan}`, [{ label: "Approve", description: "Start implementing" }, { label: "Revise", description: "Ask for changes" }], true);
          const ok = /^approve/i.test(answer.trim());
          if (ok) self.planActive = false;
          return ok;
        },
      },
      log: this.sink.log,
      settings: { webSearchEnabled: this.opts.settings.webSearchEnabled, subagentsEnabled: this.opts.settings.subagentsEnabled, provider: this.opts.provider },
      checkpoints: {
        async snapshot(p: string) {
          if (!(await exists(p))) return;
          const target = path.join(checkpointDir, `${Date.now()}-${path.basename(p)}`);
          await fs.mkdir(checkpointDir, { recursive: true });
          await fs.copyFile(p, target).catch(() => {});
        },
      },
    };
  }

  private taskManager(): TaskManager {
    return {
      spawnSubagent: async ({ description, prompt, subagentType, background }) => {
        const rec: TaskRecord = { id: newId("task"), kind: "subagent", subagentType, description, status: "running", startedAt: Date.now(), output: "", toolCalls: 0 };
        this.tasks.push(rec);
        const run = this.runSubagent(rec, prompt, subagentType as Profile);
        this.taskWaiters.set(rec.id, run);
        if (!background) await run;
        return rec;
      },
      get: (id) => this.tasks.find((t) => t.id === id),
      wait: async (id, timeoutMs) => {
        const rec = this.tasks.find((t) => t.id === id);
        const p = this.taskWaiters.get(id);
        if (rec && p && rec.status === "running") await Promise.race([p, new Promise((r) => setTimeout(r, timeoutMs))]);
        return rec;
      },
      list: () => this.tasks,
    };
  }

  private async runSubagent(rec: TaskRecord, prompt: string, profile: Profile) {
    const child = new AgentRunner(
      {
        ...this.opts,
        profile: profile === "main" ? "general" : profile,
        mode: "agent",
        history: [],
        maxTurns: 30,
        permission: profile === "general" ? this.opts.permission : { mode: "read_only", allow: [], deny: [] },
        settings: { ...this.opts.settings, subagentsEnabled: false },
        sessionAllow: this.sessionAllow,
      },
      {
        appendText: (d) => { rec.output += d; },
        appendReasoning: () => {},
        addPart: () => 0,
        updatePart: () => {},
        toolProgress: () => {},
        status: () => {},
        askUser: async (_q, options) => options[0]?.label ?? "ok",
        requestApproval: async () => (this.opts.permission.mode === "auto" ? "allow" : "deny"),
        setTodos: () => {},
        setUsage: () => {},
        log: this.sink.log,
      },
    );
    try {
      const outcome = await child.run(prompt);
      rec.toolCalls = outcome.toolCalls;
      rec.output = outcome.text || rec.output;
      rec.status = outcome.status === "complete" ? "complete" : outcome.status === "cancelled" ? "cancelled" : "error";
      if (outcome.error) rec.output += `\n\nError: ${outcome.error}`;
    } catch (e) {
      rec.status = "error";
      rec.output += `\n\nError: ${(e as Error).message}`;
    } finally {
      rec.endedAt = Date.now();
    }
  }

  private async compose(): Promise<{ system: string; specs: ProviderToolSpec[] }> {
    const profile = this.opts.profile ?? "main";
    this.provider = createProvider(this.opts.provider);
    const mcp = this.opts.mcp ?? new McpManager();
    for (const server of this.opts.settings.mcpServers.filter((s) => s.enabled)) {
      for (const t of await mcp.connect(server, (m) => this.sink.log("info", m))) this.registry.registerDynamic(t);
    }
    this.tools = this.registry.finalize({
      subagentsEnabled: this.opts.settings.subagentsEnabled && profile === "main",
      webSearchEnabled: this.opts.settings.webSearchEnabled,
      memoryEnabled: this.opts.settings.memoryEnabled,
      providerHostsWebSearch: this.provider.hostedTools.includes("web_search"),
      profile,
    });
    if (this.opts.mode === "chat") {
      this.tools = this.tools.filter((t) => ["web_search", "web_fetch", "image_gen", "memory", "ask_user_question"].includes(t.id));
    }
    this.hooks = await discoverHooks(this.opts.cwd);
    const services = this.buildServices();
    const [rules, skills, memGlobal, memWorkspace] = await Promise.all([
      loadProjectRules(this.opts.cwd),
      services.skills.list(),
      this.opts.settings.memoryEnabled ? services.memory.read("global") : Promise.resolve(""),
      this.opts.settings.memoryEnabled ? services.memory.read("workspace") : Promise.resolve(""),
    ]);
    const system = renderSystemPrompt({
      cwd: this.opts.cwd,
      workspaceRoot: this.opts.cwd,
      profile,
      mode: this.opts.mode,
      tools: this.tools,
      rules,
      skills,
      memory: { global: memGlobal, workspace: memWorkspace },
      addendum: this.opts.settings.systemPromptAddendum,
      providerHostedTools: this.provider.hostedTools,
      platformName: this.opts.platformName ?? `${os.hostname()}`,
    });
    const specs = this.tools.map((t) => ({ name: t.id, description: t.description, parameters: t.parameters }));
    return { system, specs };
  }

  /** Convert stored messages into provider turns. */
  private historyToProvider(history: Message[], prompt?: string): ProviderMessage[] {
    const out: ProviderMessage[] = [];
    for (const m of history) {
      if (m.role === "user") {
        const text = m.parts.filter((p): p is Extract<Part, { type: "text" }> => p.type === "text").map((p) => p.text).join("\n");
        if (text.trim()) out.push({ role: "user", content: text });
      } else if (m.role === "assistant") {
        let text = "";
        let calls: { id: string; name: string; args: Record<string, unknown>; result: string }[] = [];
        const flush = () => {
          if (!text.trim() && calls.length === 0) return;
          out.push({ role: "assistant", content: text.trim(), toolCalls: calls.length ? calls.map(({ id, name, args }) => ({ id, name, args })) : undefined });
          for (const c of calls) out.push({ role: "tool", toolCallId: c.id, name: c.name, content: c.result });
          text = "";
          calls = [];
        };
        for (const p of m.parts) {
          if (p.type === "text") {
            if (calls.length) flush();
            text += p.text;
          } else if (p.type === "tool_call" && !p.serverSide) {
            if (p.status === "complete" || p.status === "error" || p.status === "denied" || p.status === "cancelled") {
              calls.push({ id: p.id, name: p.name, args: p.args, result: clampText(p.result ?? p.error ?? `(tool ${p.status})`, 30_000) });
            }
          }
        }
        flush();
      }
    }
    if (prompt) out.push({ role: "user", content: prompt });
    return trimHistory(out);
  }

  async run(prompt?: string): Promise<RunOutcome> {
    const { system, specs } = await this.compose();
    const services = this.buildServices();
    let messages = this.historyToProvider(this.opts.history, prompt);
    let turns = 0;
    let toolCalls = 0;
    let finalText = "";
    const maxTurns = this.opts.maxTurns ?? 60;

    try {
      for (;;) {
        if (this.opts.signal.aborted) return { status: "cancelled", text: finalText, toolCalls, turns };
        if (turns >= maxTurns) {
          this.sink.appendText("\n\n_Reached the maximum number of turns for this run._");
          return { status: "complete", text: finalText, toolCalls, turns };
        }
        turns++;
        this.sink.status("thinking");

        let turnText = "";
        const pending: { id: string; name: string; args: Record<string, unknown>; index: number }[] = [];
        const serverParts = new Map<string, number>();
        let streamError: string | undefined;
        let finish: "stop" | "tool_calls" | "length" | "error" = "stop";
        let citations: Citation[] = [];

        for await (const ev of this.provider.stream({ system, messages, tools: specs, model: this.opts.provider.model, signal: this.opts.signal })) {
          switch (ev.type) {
            case "text":
              turnText += ev.delta;
              this.sink.appendText(ev.delta);
              break;
            case "reasoning":
              this.sink.appendReasoning(ev.delta);
              break;
            case "tool_call": {
              const tool = this.tools.find((t) => t.id === ev.name);
              const part: ToolCallPart = { type: "tool_call", id: ev.id, name: ev.name, title: tool?.title ?? ev.name, args: ev.args, status: "pending", startedAt: Date.now() };
              const index = this.sink.addPart(part);
              pending.push({ ...ev, index });
              break;
            }
            case "server_tool": {
              const existing = serverParts.get(ev.id);
              const part: ToolCallPart = { type: "tool_call", id: ev.id, name: ev.name, title: ev.name, args: ev.summary ? { query: ev.summary } : {}, status: ev.status === "running" ? "running" : "complete", serverSide: true, startedAt: Date.now(), endedAt: ev.status === "complete" ? Date.now() : undefined };
              if (existing === undefined) serverParts.set(ev.id, this.sink.addPart(part));
              else this.sink.updatePart(existing, part);
              break;
            }
            case "citations":
              citations = ev.citations;
              break;
            case "usage":
              this.sink.setUsage({ inputTokens: ev.inputTokens, outputTokens: ev.outputTokens });
              break;
            case "done":
              finish = ev.finishReason;
              break;
            case "error":
              streamError = ev.message;
              break;
          }
        }

        if (streamError) {
          this.sink.addPart({ type: "error", message: streamError });
          return { status: "error", text: finalText, toolCalls, turns, error: streamError };
        }
        if (citations.length) this.sink.addPart({ type: "citations", citations });
        finalText = turnText || finalText;

        if (pending.length === 0 || finish === "stop" && pending.length === 0) {
          return { status: this.opts.signal.aborted ? "cancelled" : "complete", text: finalText, toolCalls, turns };
        }

        messages.push({ role: "assistant", content: turnText, toolCalls: pending.map(({ id, name, args }) => ({ id, name, args })) });
        this.sink.status("tool", pending.map((p) => p.name).join(", "));

        const results = await Promise.all(pending.map((p) => this.executeTool(p, services)));
        toolCalls += results.length;
        for (let i = 0; i < pending.length; i++) {
          messages.push({ role: "tool", toolCallId: pending[i].id, name: pending[i].name, content: results[i] });
        }
        messages = trimHistory(messages);
        if (this.opts.signal.aborted) return { status: "cancelled", text: finalText, toolCalls, turns };
      }
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      this.sink.log("error", "run failed", message);
      this.sink.addPart({ type: "error", message });
      return { status: "error", text: finalText, toolCalls, turns, error: message };
    } finally {
      this.processes.killAll();
    }
  }

  private async executeTool(call: { id: string; name: string; args: Record<string, unknown>; index: number }, services: SessionServices): Promise<string> {
    const tool = this.tools.find((t) => t.id === call.name);
    const base: ToolCallPart = { type: "tool_call", id: call.id, name: call.name, title: tool?.title ?? call.name, args: call.args, status: "running", startedAt: Date.now() };
    const finish = (patch: Partial<ToolCallPart>) => this.sink.updatePart(call.index, { ...base, ...patch, endedAt: Date.now() });

    if (!tool) {
      const msg = `Unknown tool: ${call.name}. Available: ${this.tools.map((t) => t.id).join(", ")}`;
      finish({ status: "error", error: msg, result: msg });
      return msg;
    }

    const decision = evaluatePermission(tool, call.args, this.permissionConfig());
    if (decision === "deny") {
      const msg = this.planActive && !tool.readOnly ? "Blocked: plan mode is active. Call exit_plan_mode to request approval before making changes." : `Permission denied by policy for ${tool.id}.`;
      finish({ status: "denied", error: msg, result: msg });
      return msg;
    }

    const summary = tool.summarize ? safeSummary(() => tool.summarize!(call.args)) : call.name;
    const pre = await runHooks(this.hooks, "PreToolUse", { tool_name: tool.id, tool_input: call.args, cwd: this.opts.cwd }, this.opts.cwd);
    if (pre.permission === "deny") {
      const msg = `Blocked by PreToolUse hook${pre.reason ? `: ${pre.reason}` : ""}.`;
      finish({ status: "denied", error: msg, result: msg });
      return msg;
    }

    if (decision === "ask" || pre.permission === "ask") {
      this.sink.updatePart(call.index, { ...base, status: "awaiting_approval" });
      const answer = await services.requestApproval({ toolCallId: call.id, toolName: tool.id, title: tool.title, summary, args: call.args });
      if (answer === "deny") {
        const msg = "The user denied this action. Ask how they'd like to proceed instead.";
        finish({ status: "denied", error: msg, result: msg });
        return msg;
      }
      if (answer === "allow_always") this.sessionAllow.add(tool.id);
    }

    this.sink.updatePart(call.index, { ...base, status: "running" });
    this.sink.status("tool", summary);
    const ctx: ToolContext = {
      cwd: this.opts.cwd,
      workspaceRoot: this.opts.cwd,
      dataDir: this.opts.dataDir,
      signal: this.opts.signal,
      toolCallId: call.id,
      conversationId: this.opts.conversationId,
      session: services,
      progress: (chunk) => this.sink.toolProgress(call.index, chunk),
    };

    let result: ToolResult;
    try {
      result = await tool.execute(call.args, ctx);
    } catch (e) {
      result = { output: `Tool failed: ${(e as Error).message}`, isError: true };
    }
    const post = await runHooks(this.hooks, "PostToolUse", { tool_name: tool.id, tool_input: call.args, tool_output: clampText(result.output, 4000), cwd: this.opts.cwd }, this.opts.cwd);
    const output = post.additionalContext ? `${result.output}\n\n[hook] ${post.additionalContext}` : result.output;

    finish({
      status: this.opts.signal.aborted ? "cancelled" : result.isError ? "error" : "complete",
      result: clampText(output, 12_000),
      error: result.isError ? clampText(result.output, 2000) : undefined,
      display: result.display as ToolDisplay | undefined,
    });
    for (const extra of result.parts ?? []) this.sink.addPart(extra);
    return clampText(output, 40_000);
  }
}

function safeSummary(fn: () => string): string {
  try {
    return fn();
  } catch {
    return "";
  }
}

function trimHistory(messages: ProviderMessage[]): ProviderMessage[] {
  let total = messages.reduce((n, m) => n + ("content" in m ? m.content.length : 0), 0);
  if (total <= MAX_HISTORY_CHARS) return messages;
  const out = [...messages];
  // Keep the first user turn for grounding; drop the oldest middle turns (and dangling tool results).
  let i = 1;
  while (total > MAX_HISTORY_CHARS && i < out.length - 2) {
    const removed = out.splice(i, 1)[0];
    total -= "content" in removed ? removed.content.length : 0;
    while (out[i]?.role === "tool" && removed.role === "assistant") {
      const r = out.splice(i, 1)[0];
      total -= r.content.length;
    }
  }
  if (out[0]) out.splice(1, 0, { role: "user", content: "[Earlier conversation truncated for length.]" });
  return out;
}
