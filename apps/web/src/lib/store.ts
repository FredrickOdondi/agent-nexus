import { create } from "zustand";
import type {
  ApprovalRequest,
  ClientCommand,
  Conversation,
  Device,
  EphemeralEvent,
  Message,
  Part,
  PersistedEvent,
  RunStatus,
  ServerMessage,
  SkillInfo,
  SpaceSettings,
  ToolInfo,
} from "@nimbus/shared";
import { newId } from "@nimbus/shared";
import { toast } from "sonner";
import { cache, getMeta, setMeta } from "./db";
import { SyncClient, type ConnectionState } from "./client";
import { defaultDeviceName } from "./platform";

export const TOKEN_KEY = "nimbus.token";
export const DEVICE_NAME_KEY = "nimbus.deviceName";

interface UiState {
  sidebarOpen: boolean;
  settingsOpen: boolean;
  settingsTab: string;
  /** Phone settings opens on a section list unless a specific tab was requested. */
  settingsAtRoot: boolean;
  selectedId: string | null;
  draftMode: Conversation["mode"];
}

interface State extends UiState {
  connection: ConnectionState;
  deviceId: string | null;
  spaceId: string | null;
  seq: number;
  bootstrapped: boolean;
  conversations: Conversation[];
  messages: Record<string, Message[]>;
  loaded: Record<string, boolean>;
  runs: Record<string, RunStatus>;
  approvals: ApprovalRequest[];
  settings: SpaceSettings | null;
  devices: Device[];
  tools: ToolInfo[];
  skills: SkillInfo[];

  init(): Promise<void>;
  send(cmd: ClientCommand): Promise<unknown>;
  select(id: string | null): void;
  ensureMessages(id: string): Promise<void>;
  sendMessage(text: string): Promise<void>;
  newChat(): void;
  setSidebar(open: boolean): void;
  openSettings(tab?: string): void;
  showSettingsRoot(): void;
  closeSettings(): void;
  setDraftMode(mode: Conversation["mode"]): void;
  signOut(): Promise<void>;
}

let client: SyncClient | null = null;

function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].filter((c) => !c.archived).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = list.slice();
  next[idx] = item;
  return next;
}

export const useStore = create<State>((set, get) => ({
  sidebarOpen: window.innerWidth >= 1024,
  settingsOpen: false,
  settingsTab: "model",
  settingsAtRoot: true,
  selectedId: null,
  draftMode: "agent",
  connection: "connecting",
  deviceId: null,
  spaceId: null,
  seq: 0,
  bootstrapped: false,
  conversations: [],
  messages: {},
  loaded: {},
  runs: {},
  approvals: [],
  settings: null,
  devices: [],
  tools: [],
  skills: [],

  async init() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const [seq, cachedConvs, selected] = await Promise.all([
      getMeta<number>("seq"),
      cache.conversations.toArray().catch(() => [] as Conversation[]),
      getMeta<string>("selectedId"),
    ]);
    const phone = window.matchMedia("(max-width: 1023px)").matches;
    set({ seq: seq ?? 0, conversations: sortConversations(cachedConvs), selectedId: phone ? null : (selected ?? null), bootstrapped: true });
    if (!phone && selected) void get().ensureMessages(selected);

    client?.close();
    client = new SyncClient({
      token,
      deviceName: localStorage.getItem(DEVICE_NAME_KEY) ?? defaultDeviceName(),
      getSince: () => get().seq,
      onState: (connection) => set({ connection }),
      onMessage: (msg) => handleServerMessage(msg, set, get),
    });
    client.connect();
    const nudge = () => client?.nudge();
    window.addEventListener("online", nudge);
    window.addEventListener("focus", nudge);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") nudge(); });
  },

  send(cmd) {
    if (!client) return Promise.reject(new Error("Not connected"));
    return client.send(cmd);
  },

  select(id) {
    set({ selectedId: id, sidebarOpen: window.innerWidth >= 1024 ? get().sidebarOpen : false });
    void setMeta("selectedId", id);
    if (id) void get().ensureMessages(id);
  },

  async ensureMessages(id) {
    const { loaded, messages } = get();
    if (!messages[id]) {
      const cached = await cache.messages.where("conversationId").equals(id).sortBy("createdAt").catch(() => [] as Message[]);
      if (cached.length && !get().messages[id]) set((s) => ({ messages: { ...s.messages, [id]: cached } }));
    }
    if (loaded[id] || !client?.online) return;
    try {
      const res = (await client.send({ type: "messages.fetch", conversationId: id })) as { messages: Message[] };
      set((s) => ({ messages: { ...s.messages, [id]: res.messages }, loaded: { ...s.loaded, [id]: true } }));
      await cache.transaction("rw", cache.messages, async () => {
        await cache.messages.where("conversationId").equals(id).delete();
        await cache.messages.bulkPut(res.messages);
      }).catch(() => {});
    } catch {
      /* offline: cache is what we have */
    }
  },

  async sendMessage(text) {
    const { selectedId, draftMode, conversations } = get();
    const trimmed = text.trim();
    if (!trimmed) return;
    const conv = selectedId ? conversations.find((c) => c.id === selectedId) : null;
    const clientMessageId = newId("msg");
    if (conv) {
      const optimistic: Message = { id: clientMessageId, conversationId: conv.id, role: "user", parts: [{ type: "text", text: trimmed }], createdAt: Date.now(), updatedAt: Date.now(), status: "complete" };
      set((s) => ({ messages: { ...s.messages, [conv.id]: [...(s.messages[conv.id] ?? []), optimistic] } }));
    }
    try {
      const res = (await get().send({ type: "message.send", conversationId: conv?.id ?? null, text: trimmed, clientMessageId, mode: conv ? undefined : draftMode })) as { conversationId: string };
      if (!conv) {
        set((s) => ({ selectedId: res.conversationId, loaded: { ...s.loaded, [res.conversationId]: true } }));
        void setMeta("selectedId", res.conversationId);
      }
    } catch (e) {
      if (conv) set((s) => ({ messages: { ...s.messages, [conv.id]: (s.messages[conv.id] ?? []).filter((m) => m.id !== clientMessageId) } }));
      toast.error((e as Error).message);
      throw e;
    }
  },

  newChat() {
    set({ selectedId: null, sidebarOpen: window.innerWidth >= 1024 ? get().sidebarOpen : false });
    void setMeta("selectedId", null);
  },

  setSidebar: (open) => set({ sidebarOpen: open }),
  openSettings: (tab) => set({ settingsOpen: true, settingsTab: tab ?? "model", settingsAtRoot: tab == null }),
  showSettingsRoot: () => set({ settingsAtRoot: true }),
  closeSettings: () => set({ settingsOpen: false }),
  setDraftMode: (mode) => set({ draftMode: mode }),

  async signOut() {
    client?.close();
    client = null;
    localStorage.removeItem(TOKEN_KEY);
    await Promise.all([cache.conversations.clear(), cache.messages.clear(), cache.meta.clear()]).catch(() => {});
    location.hash = "";
    location.reload();
  },
}));

type Set = (fn: Partial<State> | ((s: State) => Partial<State>)) => void;
type Get = () => State;

function handleServerMessage(msg: ServerMessage, set: Set, get: Get) {
  switch (msg.type) {
    case "welcome": {
      const runs: Record<string, RunStatus> = {};
      for (const r of msg.runs) runs[r.conversationId] = r;
      set({
        deviceId: msg.deviceId,
        spaceId: msg.spaceId,
        conversations: sortConversations(msg.conversations),
        settings: msg.settings,
        devices: msg.devices,
        tools: msg.tools,
        skills: msg.skills,
        approvals: msg.pendingApprovals,
        runs,
        loaded: {},
        seq: msg.seq,
      });
      void setMeta("seq", msg.seq);
      void cache.transaction("rw", cache.conversations, async () => {
        await cache.conversations.clear();
        await cache.conversations.bulkPut(msg.conversations);
      }).catch(() => {});
      const sel = get().selectedId;
      if (sel) {
        if (msg.conversations.some((c) => c.id === sel)) void get().ensureMessages(sel);
        else get().select(null);
      }
      return;
    }
    case "events":
      for (const e of msg.events) applyPersisted(e, set, get);
      return;
    case "event":
      applyPersisted(msg.event, set, get);
      return;
    case "ephemeral":
      applyEphemeral(msg.event, set, get);
      return;
    case "error":
      if (msg.error !== "unauthorized") toast.error(msg.error);
      return;
    default:
      return;
  }
}

function applyPersisted(e: PersistedEvent, set: Set, get: Get) {
  if (e.seq <= get().seq) return;
  set({ seq: e.seq });
  void setMeta("seq", e.seq);
  const ev = e.event;
  switch (ev.type) {
    case "conversation.upsert":
      set((s) => ({ conversations: sortConversations(upsertById(s.conversations, ev.conversation)) }));
      void cache.conversations.put(ev.conversation).catch(() => {});
      return;
    case "conversation.delete":
      set((s) => {
        const messages = { ...s.messages };
        delete messages[ev.conversationId];
        return { conversations: s.conversations.filter((c) => c.id !== ev.conversationId), messages, selectedId: s.selectedId === ev.conversationId ? null : s.selectedId };
      });
      void cache.conversations.delete(ev.conversationId).catch(() => {});
      void cache.messages.where("conversationId").equals(ev.conversationId).delete().catch(() => {});
      return;
    case "message.upsert": {
      const m = ev.message;
      set((s) => {
        const list = s.messages[m.conversationId] ?? [];
        return { messages: { ...s.messages, [m.conversationId]: upsertById(list, m).sort((a, b) => a.createdAt - b.createdAt) } };
      });
      void cache.messages.put(m).catch(() => {});
      return;
    }
    case "message.delete":
      set((s) => {
        const list = s.messages[ev.conversationId];
        if (!list) return {};
        return { messages: { ...s.messages, [ev.conversationId]: list.filter((m) => m.id !== ev.messageId) } };
      });
      void cache.messages.delete(ev.messageId).catch(() => {});
      return;
    case "settings.update":
      set({ settings: ev.settings });
      return;
    case "device.upsert":
      set((s) => ({ devices: upsertById(s.devices, { ...ev.device, online: s.devices.find((d) => d.id === ev.device.id)?.online }) }));
      return;
    case "device.delete":
      set((s) => ({ devices: s.devices.filter((d) => d.id !== ev.deviceId) }));
      return;
  }
}

function patchMessage(set: Set, conversationId: string, messageId: string, fn: (m: Message) => Message) {
  set((s) => {
    const list = s.messages[conversationId];
    if (!list) return {};
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1) return {};
    const next = list.slice();
    next[idx] = fn(list[idx]);
    return { messages: { ...s.messages, [conversationId]: next } };
  });
}

function applyEphemeral(ev: EphemeralEvent, set: Set, get: Get) {
  switch (ev.type) {
    case "message.delta":
      patchMessage(set, ev.conversationId, ev.messageId, (m) => {
        const parts: Part[] = m.parts.slice();
        const existing = parts[ev.partIndex];
        if (existing && (existing.type === "text" || existing.type === "reasoning")) {
          parts[ev.partIndex] = { ...existing, text: existing.text + ev.delta };
        } else if (!existing) {
          while (parts.length < ev.partIndex) parts.push({ type: "text", text: "" });
          parts.push(ev.partType === "text" ? { type: "text", text: ev.delta } : { type: "reasoning", text: ev.delta });
        }
        return { ...m, parts, status: "streaming" };
      });
      return;
    case "message.part":
      patchMessage(set, ev.conversationId, ev.messageId, (m) => {
        const parts: Part[] = m.parts.slice();
        while (parts.length < ev.partIndex) parts.push({ type: "text", text: "" });
        parts[ev.partIndex] = ev.part;
        return { ...m, parts };
      });
      return;
    case "run.status":
      set((s) => {
        const runs = { ...s.runs };
        if (ev.status.state === "idle") delete runs[ev.status.conversationId];
        else runs[ev.status.conversationId] = ev.status;
        return { runs };
      });
      return;
    case "approval.request":
      set((s) => ({ approvals: upsertById(s.approvals, ev.request) }));
      if (ev.request.conversationId !== get().selectedId) toast(`Nimbus wants to run ${ev.request.title}`, { description: ev.request.summary, action: { label: "Review", onClick: () => get().select(ev.request.conversationId) } });
      return;
    case "approval.resolved":
      set((s) => ({ approvals: s.approvals.filter((a) => a.id !== ev.requestId) }));
      return;
    case "presence":
      set({ devices: ev.devices });
      return;
    case "toast":
      (ev.level === "error" ? toast.error : ev.level === "success" ? toast.success : toast)(ev.text);
      return;
  }
}

export function useConversation(id: string | null) {
  return useStore((s) => (id ? s.conversations.find((c) => c.id === id) ?? null : null));
}

const EMPTY: Message[] = [];
export function useMessages(id: string | null) {
  return useStore((s) => (id ? s.messages[id] ?? EMPTY : EMPTY));
}
