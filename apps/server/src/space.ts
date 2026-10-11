import type { Conversation, Device, EphemeralEvent, Message, PersistedEvent, SpaceSettings, SyncEvent } from "@nimbus/shared";
import type { Db } from "./db.js";

/**
 * All persisted mutations for one space flow through here so every write is
 * appended to the event log and fanned out to connected devices.
 */
export class SpaceService {
  private listeners = new Set<(msg: { kind: "event"; event: PersistedEvent } | { kind: "ephemeral"; event: EphemeralEvent }) => void>();

  constructor(public readonly db: Db, public readonly spaceId: string, private defaultWorkspace: string) {}

  subscribe(fn: (msg: { kind: "event"; event: PersistedEvent } | { kind: "ephemeral"; event: EphemeralEvent }) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(event: SyncEvent): PersistedEvent {
    const persisted = this.db.appendEvent(this.spaceId, event);
    for (const l of this.listeners) l({ kind: "event", event: persisted });
    return persisted;
  }

  ephemeral(event: EphemeralEvent) {
    for (const l of this.listeners) l({ kind: "ephemeral", event });
  }

  // ---- settings
  getSettings(): SpaceSettings {
    return this.db.getSettings(this.spaceId, this.defaultWorkspace);
  }

  saveSettings(settings: SpaceSettings) {
    this.db.saveSettings(this.spaceId, settings);
    this.emit({ type: "settings.update", settings: redactSettings(settings) });
  }

  // ---- conversations
  listConversations(): Conversation[] {
    return this.db.listConversations(this.spaceId);
  }

  getConversation(id: string) {
    return this.db.getConversation(id);
  }

  upsertConversation(c: Conversation) {
    this.db.upsertConversation(c);
    this.emit({ type: "conversation.upsert", conversation: c });
  }

  deleteConversation(id: string) {
    this.db.deleteConversation(id);
    this.emit({ type: "conversation.delete", conversationId: id });
  }

  // ---- messages
  listMessages(conversationId: string): Message[] {
    return this.db.listMessages(conversationId);
  }

  getMessage(id: string) {
    return this.db.getMessage(id);
  }

  upsertMessage(m: Message) {
    this.db.upsertMessage(this.spaceId, m);
    this.emit({ type: "message.upsert", message: m });
  }

  deleteMessage(conversationId: string, id: string) {
    this.db.deleteMessage(id);
    this.emit({ type: "message.delete", messageId: id, conversationId });
  }

  deleteMessagesFrom(conversationId: string, createdAt: number) {
    for (const id of this.db.deleteMessagesFrom(conversationId, createdAt)) {
      this.emit({ type: "message.delete", messageId: id, conversationId });
    }
  }

  // ---- devices
  listDevices(): Device[] {
    return this.db.listDevices(this.spaceId);
  }

  deviceUpserted(d: Device) {
    this.emit({ type: "device.upsert", device: d });
  }

  deviceDeleted(id: string) {
    this.db.deleteDevice(id);
    this.emit({ type: "device.delete", deviceId: id });
  }
}

export function redactSettings(s: SpaceSettings): SpaceSettings {
  const { apiKey, ...provider } = s.provider;
  const { composioApiKey, composioSessionId: _session, composioUserId: _user, ...rest } = s;
  const fromSettings = Boolean(composioApiKey);
  const fromEnv = Boolean(process.env.COMPOSIO_API_KEY);
  return {
    ...rest,
    provider: { ...provider, hasApiKey: Boolean(apiKey) },
    hasComposioApiKey: fromSettings || fromEnv,
    composioKeySource: fromSettings ? "settings" : fromEnv ? "env" : "none",
  };
}
