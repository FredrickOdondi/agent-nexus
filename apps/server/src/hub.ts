import type { IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, Conversation, Device, Message, ServerMessage, SpaceSettings } from "@nimbus/shared";
import { BUILTIN_TOOL_CATALOG, COMPOSIO_META_TOOLS, deriveTitle, newId, truncate } from "@nimbus/shared";
import { createSkillCatalog } from "@nimbus/agent-core";
import type { Db } from "./db.js";
import type { RunManager } from "./runs.js";
import { redactSettings, type SpaceService } from "./space.js";

interface Connection {
  ws: WebSocket;
  device: Device | null;
  alive: boolean;
}

export class Hub {
  private wss: WebSocketServer;
  private conns = new Set<Connection>();

  constructor(
    private db: Db,
    private space: SpaceService,
    private runs: RunManager,
    private log: (level: string, msg: string, extra?: unknown) => void,
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (ws) => this.onConnection(ws));
    space.subscribe((msg) => {
      const payload: ServerMessage = msg.kind === "event" ? { type: "event", event: msg.event } : { type: "ephemeral", event: msg.event };
      this.broadcast(payload);
    });
    setInterval(() => {
      for (const c of this.conns) {
        if (!c.alive) { c.ws.terminate(); this.conns.delete(c); continue; }
        c.alive = false;
        c.ws.ping();
      }
    }, 30_000).unref();
  }

  handleUpgrade(req: IncomingMessage, socket: any, head: Buffer) {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
  }

  private broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const c of this.conns) if (c.device && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }

  private send(c: Connection, msg: ServerMessage) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  }

  private presence() {
    const online = new Set([...this.conns].filter((c) => c.device).map((c) => c.device!.id));
    const devices = this.space.listDevices().map((d) => ({ ...d, online: online.has(d.id) }));
    this.space.ephemeral({ type: "presence", devices });
  }

  private onConnection(ws: WebSocket) {
    const conn: Connection = { ws, device: null, alive: true };
    this.conns.add(conn);
    ws.on("pong", () => (conn.alive = true));
    ws.on("close", () => {
      this.conns.delete(conn);
      if (conn.device) this.presence();
    });
    ws.on("message", async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return this.send(conn, { type: "error", error: "Malformed message" });
      }
      try {
        await this.handle(conn, msg);
      } catch (e) {
        this.log("error", "command failed", (e as Error).message);
        if (msg.requestId) this.send(conn, { type: "ack", requestId: msg.requestId, ok: false, error: (e as Error).message });
        else this.send(conn, { type: "error", error: (e as Error).message });
      }
    });
  }

  private async handle(conn: Connection, msg: ClientMessage) {
    const ack = (result?: unknown) => { if (msg.requestId) this.send(conn, { type: "ack", requestId: msg.requestId, ok: true, result }); };

    if (msg.type === "hello") {
      const device = this.db.deviceByToken(msg.token);
      if (!device || device.spaceId !== this.space.spaceId) {
        this.send(conn, { type: "error", error: "unauthorized" });
        conn.ws.close(4001, "unauthorized");
        return;
      }
      conn.device = device;
      this.db.touchDevice(device.id);
      if (msg.deviceName && msg.deviceName !== device.name) this.db.renameDevice(device.id, msg.deviceName);
      const skills = await createSkillCatalog(this.space.getSettings().workspacePath).list().catch(() => []);
      const settings = this.space.getSettings();
      const providerHosted = settings.provider.kind === "xai" && settings.provider.serverTools && Boolean(settings.provider.apiKey);
      const welcome: ServerMessage = {
        type: "welcome",
        deviceId: device.id,
        spaceId: this.space.spaceId,
        seq: this.db.latestSeq(this.space.spaceId),
        conversations: this.space.listConversations(),
        settings: redactSettings(settings),
        devices: this.space.listDevices(),
        tools: [
          ...BUILTIN_TOOL_CATALOG.map((t) => ({
            ...t,
            enabled:
              t.source === "provider" ? providerHosted
              : t.id === "task" ? settings.subagentsEnabled
              : t.id === "memory" ? settings.memoryEnabled
              : t.id === "web_search" ? settings.webSearchEnabled
              : true,
          })),
          ...(settings.composioEnabled !== false && (settings.composioApiKey || process.env.COMPOSIO_API_KEY)
            ? COMPOSIO_META_TOOLS.map((t) => ({ ...t, enabled: true }))
            : []),
        ],
        skills,
        pendingApprovals: this.runs.pendingApprovals(),
        runs: this.runs.statuses(),
      };
      this.send(conn, welcome);
      const { events, oldest } = this.db.eventsSince(this.space.spaceId, msg.since);
      if (msg.since > 0 && oldest > msg.since + 1) {
        // Client is too far behind for incremental replay; welcome already carries full conversation state.
        this.send(conn, { type: "events", events: [] });
      } else if (events.length) {
        this.send(conn, { type: "events", events });
      }
      this.presence();
      return;
    }

    if (!conn.device) {
      this.send(conn, { type: "error", error: "Send hello first" });
      return;
    }
    const device = conn.device;

    switch (msg.type) {
      case "ping":
        return ack();

      case "messages.fetch":
        return ack({ messages: this.space.listMessages(msg.conversationId) });

      case "conversation.create": {
        const conv = this.newConversation(msg.title ?? "New chat", msg.mode ?? "agent", msg.workspacePath ?? null);
        this.space.upsertConversation(conv);
        return ack({ conversation: conv });
      }

      case "conversation.update": {
        const conv = this.space.getConversation(msg.conversationId);
        if (!conv) throw new Error("Conversation not found");
        Object.assign(conv, msg.patch, { updatedAt: Date.now() });
        this.space.upsertConversation(conv);
        return ack();
      }

      case "conversation.delete":
        this.runs.cancel(msg.conversationId);
        this.space.deleteConversation(msg.conversationId);
        return ack();

      case "message.send": {
        let conv = msg.conversationId ? this.space.getConversation(msg.conversationId) : null;
        if (!conv) {
          conv = this.newConversation(deriveTitle(msg.text), msg.mode ?? "agent", msg.workspacePath ?? null);
          this.space.upsertConversation(conv);
        }
        if (this.runs.isRunning(conv.id)) throw new Error("Nimbus is still working on this chat. Stop it first or wait for it to finish.");
        const now = Date.now();
        const userMessage: Message = { id: msg.clientMessageId || newId("msg"), conversationId: conv.id, role: "user", parts: [{ type: "text", text: msg.text }], createdAt: now, updatedAt: now, status: "complete", deviceId: device.id };
        this.space.upsertMessage(userMessage);
        const history = this.space.listMessages(conv.id).filter((m) => m.id !== userMessage.id);
        const assistant: Message = { id: newId("msg"), conversationId: conv.id, role: "assistant", parts: [], createdAt: now + 1, updatedAt: now + 1, status: "streaming" };
        this.space.upsertMessage(assistant);
        conv.preview = truncate(msg.text, 90);
        conv.updatedAt = now;
        conv.messageCount += 2;
        if (conv.title === "New chat") conv.title = deriveTitle(msg.text);
        this.space.upsertConversation(conv);
        ack({ conversationId: conv.id, messageId: assistant.id });
        void this.runs.start(conv, history, msg.text, assistant).catch((e) => this.log("error", "run start failed", e));
        return;
      }

      case "message.regenerate": {
        const conv = this.space.getConversation(msg.conversationId);
        if (!conv) throw new Error("Conversation not found");
        if (this.runs.isRunning(conv.id)) throw new Error("A run is already active.");
        const all = this.space.listMessages(conv.id);
        const idx = all.findIndex((m) => m.id === msg.messageId);
        if (idx < 0) throw new Error("Message not found");
        const target = all[idx];
        const userIdx = target.role === "assistant" ? idx - 1 : idx;
        const history = all.slice(0, userIdx);
        const userMessage = all[userIdx];
        if (!userMessage || userMessage.role !== "user") throw new Error("Nothing to regenerate");
        this.space.deleteMessagesFrom(conv.id, userMessage.createdAt + 1);
        const now = Date.now();
        const assistant: Message = { id: newId("msg"), conversationId: conv.id, role: "assistant", parts: [], createdAt: now, updatedAt: now, status: "streaming" };
        this.space.upsertMessage(assistant);
        ack({ messageId: assistant.id });
        const prompt = userMessage.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
        void this.runs.start(conv, history, prompt, assistant).catch((e) => this.log("error", "regenerate failed", e));
        return;
      }

      case "rewind": {
        const conv = this.space.getConversation(msg.conversationId);
        if (!conv) throw new Error("Conversation not found");
        this.runs.cancel(conv.id);
        const target = this.space.getMessage(msg.messageId);
        if (!target) throw new Error("Message not found");
        this.space.deleteMessagesFrom(conv.id, target.createdAt);
        conv.messageCount = this.space.listMessages(conv.id).length;
        conv.updatedAt = Date.now();
        this.space.upsertConversation(conv);
        return ack();
      }

      case "run.cancel":
        this.runs.cancel(msg.conversationId);
        return ack();

      case "approval.respond":
        if (!this.runs.respondApproval(msg.approvalId, msg.decision)) throw new Error("Approval request no longer pending");
        return ack();

      case "question.answer":
        this.runs.answerQuestion(msg.conversationId, msg.messageId, msg.questionId, msg.answer, device.name);
        return ack();

      case "settings.update": {
        const current = this.space.getSettings();
        const { provider: providerPatch, hasComposioApiKey: _has, composioKeySource: _source, composioSessionId: _session, composioUserId: _user, ...rest } = msg.patch;
        const next: SpaceSettings = { ...current, ...rest, provider: { ...current.provider, ...(providerPatch ?? {}) } };
        if (providerPatch && "apiKey" in providerPatch && !providerPatch.apiKey) delete next.provider.apiKey;
        delete next.provider.hasApiKey;
        if ("composioApiKey" in msg.patch) {
          const incoming = typeof msg.patch.composioApiKey === "string" ? msg.patch.composioApiKey.trim() : "";
          if (!incoming) {
            delete next.composioApiKey;
            delete next.composioSessionId;
          } else if (incoming !== current.composioApiKey) {
            next.composioApiKey = incoming;
            delete next.composioSessionId;
          }
        }
        delete next.hasComposioApiKey;
        delete next.composioKeySource;
        this.space.saveSettings(next);
        return ack();
      }

      case "device.rename": {
        this.db.renameDevice(msg.deviceId, msg.name.trim().slice(0, 60) || "Device");
        const d = this.db.deviceById(msg.deviceId);
        if (d) this.space.deviceUpserted(d);
        return ack();
      }

      case "device.revoke": {
        const d = this.db.deviceById(msg.deviceId);
        if (!d) throw new Error("Device not found");
        if (d.primary) throw new Error("The primary device cannot be unlinked");
        this.space.deviceDeleted(msg.deviceId);
        for (const c of this.conns) if (c.device?.id === msg.deviceId) c.ws.close(4002, "revoked");
        return ack();
      }

      default:
        throw new Error(`Unknown command ${(msg as { type: string }).type}`);
    }
  }

  private newConversation(title: string, mode: Conversation["mode"], workspacePath: string | null): Conversation {
    const now = Date.now();
    return { id: newId("conv"), spaceId: this.space.spaceId, title, createdAt: now, updatedAt: now, pinned: false, archived: false, workspacePath, mode, model: null, preview: "", messageCount: 0 };
  }
}
