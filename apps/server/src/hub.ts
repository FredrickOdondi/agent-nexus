import { promises as fs } from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, Conversation, Device, Message, ServerMessage, SpaceSettings } from "@nimbus/shared";
import { BUILTIN_TOOL_CATALOG, COMPOSIO_META_TOOLS, deriveTitle, newId, truncate } from "@nimbus/shared";
import { createSkillCatalog, createSubagentCatalog } from "@nimbus/agent-core";
import type { Db } from "./db.js";
import type { SpaceRegistry } from "./registry.js";
import { redactSettings } from "./space.js";

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
    private registry: SpaceRegistry,
    private log: (level: string, msg: string, extra?: unknown) => void,
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    this.wss.on("connection", (ws) => this.onConnection(ws));
    registry.onSpace((rt) => {
      const spaceId = rt.space.spaceId;
      rt.space.subscribe((msg) => {
        const payload: ServerMessage = msg.kind === "event" ? { type: "event", event: msg.event } : { type: "ephemeral", event: msg.event };
        this.broadcast(spaceId, payload);
      });
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

  private broadcast(spaceId: string, msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const c of this.conns) if (c.device?.spaceId === spaceId && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }

  private send(c: Connection, msg: ServerMessage) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  }

  private presence(spaceId: string) {
    const rt = this.registry.get(spaceId);
    const online = new Set([...this.conns].filter((c) => c.device?.spaceId === spaceId).map((c) => c.device!.id));
    const devices = rt.space.listDevices().map((d) => ({ ...d, online: online.has(d.id) }));
    rt.space.ephemeral({ type: "presence", devices });
  }

  private onConnection(ws: WebSocket) {
    const conn: Connection = { ws, device: null, alive: true };
    this.conns.add(conn);
    ws.on("pong", () => (conn.alive = true));
    ws.on("close", () => {
      this.conns.delete(conn);
      if (conn.device) this.presence(conn.device.spaceId);
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
      if (!device) {
        this.send(conn, { type: "error", error: "unauthorized" });
        conn.ws.close(4001, "unauthorized");
        return;
      }
      const rt = this.registry.get(device.spaceId);
      conn.device = device;
      this.db.touchDevice(device.id);
      if (msg.deviceName && msg.deviceName !== device.name) this.db.renameDevice(device.id, msg.deviceName);
      const [skills, subagents] = await Promise.all([
        createSkillCatalog(rt.space.getSettings().workspacePath).list().catch(() => []),
        createSubagentCatalog(rt.space.getSettings().workspacePath, this.registry.dataDir).list().catch(() => []),
      ]);
      const settings = rt.space.getSettings();
      const providerHosted = settings.provider.kind === "xai" && settings.provider.serverTools && Boolean(settings.provider.apiKey);
      const welcome: ServerMessage = {
        type: "welcome",
        deviceId: device.id,
        spaceId: rt.space.spaceId,
        seq: this.db.latestSeq(rt.space.spaceId),
        conversations: rt.space.listConversations(),
        settings: redactSettings(settings),
        subscription: rt.space.getSubscription(),
        devices: rt.space.listDevices(),
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
        subagents,
        pendingApprovals: rt.runs.pendingApprovals(),
        runs: rt.runs.statuses(),
      };
      this.send(conn, welcome);
      const { events, oldest } = this.db.eventsSince(rt.space.spaceId, msg.since);
      if (msg.since > 0 && oldest > msg.since + 1) {
        // Client is too far behind for incremental replay; welcome already carries full conversation state.
        this.send(conn, { type: "events", events: [] });
      } else if (events.length) {
        this.send(conn, { type: "events", events });
      }
      this.presence(device.spaceId);
      return;
    }

    if (!conn.device) {
      this.send(conn, { type: "error", error: "Send hello first" });
      return;
    }
    const device = conn.device;
    const rt = this.registry.get(device.spaceId);
    const space = rt.space;
    const runs = rt.runs;

    switch (msg.type) {
      case "ping":
        return ack();

      case "messages.fetch":
        return ack({ messages: space.listMessages(msg.conversationId) });

      case "conversation.create": {
        const conv = this.newConversation(space.spaceId, msg.title ?? "New chat", msg.mode ?? "agent", msg.workspacePath ?? null);
        space.upsertConversation(conv);
        return ack({ conversation: conv });
      }

      case "conversation.update": {
        const conv = space.getConversation(msg.conversationId);
        if (!conv) throw new Error("Conversation not found");
        Object.assign(conv, msg.patch, { id: conv.id, spaceId: space.spaceId, updatedAt: Date.now() });
        space.upsertConversation(conv);
        return ack();
      }

      case "conversation.delete":
        runs.cancel(msg.conversationId);
        space.deleteConversation(msg.conversationId);
        return ack();

      case "message.send": {
        let conv = msg.conversationId ? space.getConversation(msg.conversationId) : null;
        if (!conv) {
          conv = this.newConversation(space.spaceId, deriveTitle(msg.text), msg.mode ?? "agent", msg.workspacePath ?? null);
          space.upsertConversation(conv);
        }
        if (runs.isRunning(conv.id)) throw new Error("Nimbus is still working on this chat. Stop it first or wait for it to finish.");
        const now = Date.now();
        const userMessage: Message = { id: msg.clientMessageId || newId("msg"), conversationId: conv.id, role: "user", parts: [{ type: "text", text: msg.text }], createdAt: now, updatedAt: now, status: "complete", deviceId: device.id };
        space.upsertMessage(userMessage);
        const history = space.listMessages(conv.id).filter((m) => m.id !== userMessage.id);
        const assistant: Message = { id: newId("msg"), conversationId: conv.id, role: "assistant", parts: [], createdAt: now + 1, updatedAt: now + 1, status: "streaming" };
        space.upsertMessage(assistant);
        conv.preview = truncate(msg.text, 90);
        conv.updatedAt = now;
        conv.messageCount += 2;
        if (conv.title === "New chat") conv.title = deriveTitle(msg.text);
        space.upsertConversation(conv);
        ack({ conversationId: conv.id, messageId: assistant.id });
        void runs.start(conv, history, msg.text, assistant).catch((e) => this.log("error", "run start failed", e));
        return;
      }

      case "message.regenerate": {
        const conv = space.getConversation(msg.conversationId);
        if (!conv) throw new Error("Conversation not found");
        if (runs.isRunning(conv.id)) throw new Error("A run is already active.");
        const all = space.listMessages(conv.id);
        const idx = all.findIndex((m) => m.id === msg.messageId);
        if (idx < 0) throw new Error("Message not found");
        const target = all[idx];
        const userIdx = target.role === "assistant" ? idx - 1 : idx;
        const history = all.slice(0, userIdx);
        const userMessage = all[userIdx];
        if (!userMessage || userMessage.role !== "user") throw new Error("Nothing to regenerate");
        space.deleteMessagesFrom(conv.id, userMessage.createdAt + 1);
        const now = Date.now();
        const assistant: Message = { id: newId("msg"), conversationId: conv.id, role: "assistant", parts: [], createdAt: now, updatedAt: now, status: "streaming" };
        space.upsertMessage(assistant);
        ack({ messageId: assistant.id });
        const prompt = userMessage.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
        void runs.start(conv, history, prompt, assistant).catch((e) => this.log("error", "regenerate failed", e));
        return;
      }

      case "rewind": {
        const conv = space.getConversation(msg.conversationId);
        if (!conv) throw new Error("Conversation not found");
        runs.cancel(conv.id);
        const target = space.getMessage(msg.messageId);
        if (!target) throw new Error("Message not found");
        space.deleteMessagesFrom(conv.id, target.createdAt);
        conv.messageCount = space.listMessages(conv.id).length;
        conv.updatedAt = Date.now();
        space.upsertConversation(conv);
        return ack();
      }

      case "run.cancel":
        runs.cancel(msg.conversationId);
        return ack();

      case "approval.respond":
        if (!runs.respondApproval(msg.approvalId, msg.decision)) throw new Error("Approval request no longer pending");
        return ack();

      case "question.answer":
        runs.answerQuestion(msg.conversationId, msg.messageId, msg.questionId, msg.answer, device.name);
        return ack();

      case "settings.update": {
        const current = space.getSettings();
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
        space.saveSettings(next);
        return ack();
      }

      case "device.rename": {
        const current = this.db.deviceById(msg.deviceId);
        if (!current || current.spaceId !== space.spaceId) throw new Error("Device not found");
        this.db.renameDevice(msg.deviceId, msg.name.trim().slice(0, 60) || "Device");
        const d = this.db.deviceById(msg.deviceId);
        if (d) space.deviceUpserted(d);
        return ack();
      }

      case "device.revoke": {
        const d = this.db.deviceById(msg.deviceId);
        if (!d || d.spaceId !== space.spaceId) throw new Error("Device not found");
        if (d.primary) throw new Error("The primary device cannot be unlinked");
        space.deviceDeleted(msg.deviceId);
        for (const c of this.conns) if (c.device?.id === msg.deviceId) c.ws.close(4002, "revoked");
        return ack();
      }

      case "subagent.upsert": {
        const cleanName = msg.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
        if (!cleanName) throw new Error("Invalid subagent name");

        // Check subagent limits for Freemium tier
        const catalog = createSubagentCatalog(space.getSettings().workspacePath, this.registry.dataDir);
        const existing = await catalog.load(cleanName).catch(() => null);
        if (!existing) {
          const currentList = await catalog.list().catch(() => []);
          const customCount = currentList.filter((s) => s.scope !== "builtin").length;
          const sub = space.getSubscription();
          if (customCount >= sub.limits.maxSubagents) {
            throw new Error(`The Free plan allows up to ${sub.limits.maxSubagents} custom subagents. Upgrade to Pro for unlimited subagents.`);
          }
        }

        const scope = msg.scope ?? "local";
        const dir = scope === "user"
          ? path.join(os.homedir(), ".nimbus/subagents")
          : path.join(space.getSettings().workspacePath, ".nimbus/subagents");
        await fs.mkdir(dir, { recursive: true });
        const filePath = path.join(dir, `${cleanName}.md`);
        const lines: string[] = [
          "---",
          `name: ${cleanName}`,
          `description: "${(msg.description || cleanName).replace(/"/g, '\\"')}"`,
        ];
        if (msg.avatar) {
          lines.push(`avatar: ${msg.avatar}`);
        }
        if (msg.tools && msg.tools.length > 0) {
          lines.push(`tools: ${msg.tools.join(", ")}`);
        }
        if (msg.model) {
          lines.push(`model: ${msg.model}`);
        }
        lines.push("---", "", (msg.prompt || "").trim(), "");
        await fs.writeFile(filePath, lines.join("\n"), "utf8");
        const userDir = path.join(os.homedir(), ".nimbus/subagents");
        await fs.mkdir(userDir, { recursive: true }).catch(() => {});
        await fs.writeFile(path.join(userDir, `${cleanName}.md`), lines.join("\n"), "utf8").catch(() => {});
        const subagents = await createSubagentCatalog(space.getSettings().workspacePath, this.registry.dataDir).list();
        space.ephemeral({ type: "subagents.update", subagents });
        return ack({ subagents });
      }

      case "subagent.delete": {
        const cleanName = msg.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
        const catalog = createSubagentCatalog(space.getSettings().workspacePath, this.registry.dataDir);
        const subagent = await catalog.load(cleanName);
        if (!subagent) throw new Error(`Subagent '${cleanName}' not found`);
        if (subagent.scope === "builtin" || !subagent.path) throw new Error(`Cannot delete built-in subagent '${cleanName}'`);
        await fs.unlink(subagent.path).catch(() => {});
        const userPath = path.join(os.homedir(), ".nimbus/subagents", `${cleanName}.md`);
        await fs.unlink(userPath).catch(() => {});
        const subagents = await catalog.list();
        space.ephemeral({ type: "subagents.update", subagents });
        return ack({ subagents });
      }

      case "subscription.start_trial": {
        const sub = space.startTrial();
        return ack({ subscription: sub });
      }

      case "subscription.activate_license": {
        const sub = space.activateLicense(msg.licenseKey);
        return ack({ subscription: sub });
      }

      case "subscription.reset": {
        const sub = space.resetSubscription();
        return ack({ subscription: sub });
      }

      default:
        throw new Error(`Unknown command ${(msg as { type: string }).type}`);
    }
  }

  private newConversation(spaceId: string, title: string, mode: Conversation["mode"], workspacePath: string | null): Conversation {
    const now = Date.now();
    return { id: newId("conv"), spaceId, title, createdAt: now, updatedAt: now, pinned: false, archived: false, workspacePath, mode, model: null, preview: "", messageCount: 0 };
  }
}
