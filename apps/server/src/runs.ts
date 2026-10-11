import { promises as fs } from "node:fs";
import type { ApprovalRequest, Conversation, Message, Part, QuestionOption, RunStatus, TodoItem } from "@nimbus/shared";
import { deriveTitle, messageText, newId, truncate } from "@nimbus/shared";
import { AgentRunner, McpManager, type ApprovalAnswer, type ApprovalPrompt, type RunSink } from "@nimbus/agent-core";
import { rememberComposioSession, composioRuntime } from "./composio-host.js";
import type { SpaceService } from "./space.js";

interface ActiveRun {
  conversationId: string;
  messageId: string;
  controller: AbortController;
  status: RunStatus;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (a: ApprovalAnswer) => void;
}

interface PendingQuestion {
  conversationId: string;
  messageId: string;
  questionId: string;
  resolve: (answer: string) => void;
}

/**
 * Owns agent runs for a space: one active run per conversation, approval and
 * question routing (any linked device may answer), and persistence of the
 * streaming assistant message so late-joining devices catch up.
 */
export class RunManager {
  private runs = new Map<string, ActiveRun>();
  private approvals = new Map<string, PendingApproval>();
  private questions = new Map<string, PendingQuestion>();
  private sessionAllow = new Map<string, Set<string>>();
  private mcp = new McpManager();

  constructor(private space: SpaceService, private dataDir: string, private platformName: string, private log: (level: string, msg: string, extra?: unknown) => void) {}

  statuses(): RunStatus[] {
    return [...this.runs.values()].map((r) => r.status);
  }

  pendingApprovals(): ApprovalRequest[] {
    return [...this.approvals.values()].map((p) => p.request);
  }

  isRunning(conversationId: string) {
    return this.runs.has(conversationId);
  }

  cancel(conversationId: string) {
    const run = this.runs.get(conversationId);
    if (!run) return;
    run.controller.abort();
    for (const [id, q] of this.questions) if (q.conversationId === conversationId) { q.resolve("(cancelled)"); this.questions.delete(id); }
    for (const [id, a] of this.approvals) if (a.request.conversationId === conversationId) { a.resolve("deny"); this.approvals.delete(id); this.space.ephemeral({ type: "approval.resolved", requestId: id }); }
  }

  respondApproval(requestId: string, decision: ApprovalAnswer): boolean {
    const p = this.approvals.get(requestId);
    if (!p) return false;
    this.approvals.delete(requestId);
    p.resolve(decision);
    this.space.ephemeral({ type: "approval.resolved", requestId });
    return true;
  }

  answerQuestion(conversationId: string, messageId: string, questionId: string, answer: string, deviceName: string): boolean {
    const key = `${messageId}:${questionId}`;
    const q = this.questions.get(key);
    const message = this.space.getMessage(messageId);
    if (message) {
      const part = message.parts.find((p) => p.type === "question" && p.id === questionId);
      if (part && part.type === "question") {
        part.answer = answer;
        part.answeredBy = deviceName;
        message.updatedAt = Date.now();
        this.space.upsertMessage(message);
      }
    }
    if (!q || q.conversationId !== conversationId) return false;
    this.questions.delete(key);
    q.resolve(answer);
    return true;
  }

  async start(conversation: Conversation, history: Message[], prompt: string | undefined, assistant: Message) {
    if (this.runs.has(conversation.id)) throw new Error("A run is already active for this conversation.");
    const settings = this.space.getSettings();
    const cwd = conversation.workspacePath || settings.workspacePath;
    await fs.mkdir(cwd, { recursive: true }).catch(() => {});

    const controller = new AbortController();
    const status: RunStatus = { conversationId: conversation.id, state: "thinking", messageId: assistant.id };
    const run: ActiveRun = { conversationId: conversation.id, messageId: assistant.id, controller, status };
    this.runs.set(conversation.id, run);
    this.space.ephemeral({ type: "run.status", status });

    const message = assistant;
    let dirty = false;
    let lastPersist = Date.now();
    const persist = (force = false) => {
      if (!dirty && !force) return;
      message.updatedAt = Date.now();
      this.space.upsertMessage(message);
      dirty = false;
      lastPersist = Date.now();
    };
    const persistTimer = setInterval(() => { if (dirty && Date.now() - lastPersist > 1200) persist(); }, 400);

    const ensureTextPart = (type: "text" | "reasoning"): number => {
      const last = message.parts[message.parts.length - 1];
      if (last && last.type === type) return message.parts.length - 1;
      message.parts.push(type === "text" ? { type: "text", text: "" } : { type: "reasoning", text: "" });
      return message.parts.length - 1;
    };

    const sink: RunSink = {
      appendText: (delta) => {
        const idx = ensureTextPart("text");
        (message.parts[idx] as { text: string }).text += delta;
        dirty = true;
        this.space.ephemeral({ type: "message.delta", conversationId: conversation.id, messageId: message.id, partIndex: idx, delta, partType: "text" });
      },
      appendReasoning: (delta) => {
        const idx = ensureTextPart("reasoning");
        (message.parts[idx] as { text: string }).text += delta;
        dirty = true;
        this.space.ephemeral({ type: "message.delta", conversationId: conversation.id, messageId: message.id, partIndex: idx, delta, partType: "reasoning" });
      },
      addPart: (part) => {
        message.parts.push(part);
        const idx = message.parts.length - 1;
        this.space.ephemeral({ type: "message.part", conversationId: conversation.id, messageId: message.id, partIndex: idx, part });
        persist(true);
        return idx;
      },
      updatePart: (index, part) => {
        if (index < 0 || index >= message.parts.length) return;
        message.parts[index] = part;
        this.space.ephemeral({ type: "message.part", conversationId: conversation.id, messageId: message.id, partIndex: index, part });
        persist(true);
      },
      toolProgress: (index, chunk) => {
        const part = message.parts[index];
        if (!part || part.type !== "tool_call") return;
        const display = part.display?.kind === "terminal" ? part.display : { kind: "terminal" as const, command: String(part.args.command ?? ""), output: "", exitCode: null, cwd };
        display.output = (display.output + chunk).slice(-20_000);
        part.display = display;
        this.space.ephemeral({ type: "message.part", conversationId: conversation.id, messageId: message.id, partIndex: index, part });
      },
      status: (state, detail) => {
        run.status = { conversationId: conversation.id, state, messageId: message.id, detail: detail ? truncate(detail, 80) : undefined };
        this.space.ephemeral({ type: "run.status", status: run.status });
      },
      askUser: (question: string, options: QuestionOption[], allowFreeform: boolean) => {
        const questionId = newId("q");
        const part: Part = { type: "question", id: questionId, question, options, allowFreeform };
        sink.addPart(part);
        return new Promise<string>((resolve) => {
          this.questions.set(`${message.id}:${questionId}`, { conversationId: conversation.id, messageId: message.id, questionId, resolve });
          controller.signal.addEventListener("abort", () => resolve("(cancelled)"), { once: true });
        });
      },
      requestApproval: (prompt: ApprovalPrompt) => {
        const request: ApprovalRequest = {
          id: newId("apr"),
          conversationId: conversation.id,
          messageId: message.id,
          toolCallId: prompt.toolCallId,
          toolName: prompt.toolName,
          title: prompt.title,
          summary: prompt.summary,
          args: prompt.args,
          createdAt: Date.now(),
        };
        return new Promise<ApprovalAnswer>((resolve) => {
          this.approvals.set(request.id, { request, resolve });
          this.space.ephemeral({ type: "approval.request", request });
          controller.signal.addEventListener("abort", () => resolve("deny"), { once: true });
        });
      },
      setTodos: (todos: TodoItem[]) => this.space.db.saveTodos(conversation.id, todos),
      setUsage: (usage) => { message.usage = usage; dirty = true; },
      log: (level, msg, extra) => this.log(level, msg, extra),
    };

    const allow = this.sessionAllow.get(conversation.id) ?? new Set<string>();
    this.sessionAllow.set(conversation.id, allow);

    const runner = new AgentRunner(
      {
        conversationId: conversation.id,
        cwd,
        dataDir: this.dataDir,
        mode: conversation.mode,
        provider: settings.provider,
        permission: { mode: settings.permissionMode, allow: settings.allowRules, deny: settings.denyRules },
        settings: {
          webSearchEnabled: settings.webSearchEnabled,
          subagentsEnabled: settings.subagentsEnabled,
          memoryEnabled: settings.memoryEnabled,
          mcpServers: settings.mcpServers,
          systemPromptAddendum: settings.systemPromptAddendum,
          composio: composioRuntime(settings, this.space.spaceId),
        },
        history,
        signal: controller.signal,
        platformName: this.platformName,
        mcp: this.mcp,
        sessionAllow: allow,
        onComposioSession: (sessionId) => rememberComposioSession(this.space, sessionId),
      },
      sink,
    );

    message.model = settings.provider.model;
    const started = Date.now();
    try {
      const outcome = await runner.run(prompt);
      message.status = outcome.status === "cancelled" ? "cancelled" : outcome.status === "error" ? "error" : "complete";
      for (const p of message.parts) if (p.type === "reasoning" && !p.durationMs) p.durationMs = Date.now() - started;
    } catch (e) {
      message.status = "error";
      message.parts.push({ type: "error", message: (e as Error).message });
    } finally {
      clearInterval(persistTimer);
      message.parts = message.parts.filter((p) => !(p.type === "text" && !p.text) && !(p.type === "reasoning" && !p.text));
      persist(true);
      this.runs.delete(conversation.id);
      this.space.ephemeral({ type: "run.status", status: { conversationId: conversation.id, state: "idle" } });

      const conv = this.space.getConversation(conversation.id);
      if (conv) {
        const text = messageText(message);
        conv.preview = truncate(text || (message.status === "error" ? "Run failed" : "…"), 90);
        conv.updatedAt = Date.now();
        conv.messageCount = this.space.listMessages(conv.id).length;
        if (conv.title === "New chat" && history[0]) conv.title = deriveTitle(messageText(history[0]));
        this.space.upsertConversation(conv);
      }
    }
  }
}
