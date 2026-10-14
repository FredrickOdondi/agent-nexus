import type { Conversation, Device, EphemeralEvent, Message, PersistedEvent, SpaceSettings, SubscriptionInfo, SyncEvent } from "@nimbus/shared";
import { DEFAULT_FREE_SUBSCRIPTION, FREE_PLAN_LIMITS, PRO_PLAN_LIMITS, TRIAL_DURATION_MS } from "@nimbus/shared";
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

  // ---- subscription & billing
  getSubscription(): SubscriptionInfo {
    return this.db.getSubscription(this.spaceId);
  }

  saveSubscription(sub: SubscriptionInfo) {
    this.db.saveSubscription(this.spaceId, sub);
    this.emit({ type: "subscription.update", subscription: sub });
  }

  startTrial(): SubscriptionInfo {
    const current = this.getSubscription();
    if (!current.isTrialEligible && current.status !== "expired") {
      throw new Error("This space has already used its 14-day Pro trial.");
    }
    const now = Date.now();
    const trial: SubscriptionInfo = {
      tier: "pro",
      status: "trialing",
      planName: "Nimbus Pro (Trial)",
      trialStartedAt: now,
      trialExpiresAt: now + TRIAL_DURATION_MS,
      isTrialEligible: false,
      limits: PRO_PLAN_LIMITS,
    };
    this.saveSubscription(trial);
    return trial;
  }

  activateLicense(rawKey: string): SubscriptionInfo {
    const key = rawKey.trim();
    if (!key || key.length < 5) throw new Error("Please enter a valid license key.");
    const upper = key.toUpperCase();
    const isLifetime = upper.includes("LIFE") || upper.includes("LIFETIME");
    const planName = isLifetime ? "Nimbus Pro (Lifetime)" : "Nimbus Pro";
    const billingInterval = isLifetime ? "lifetime" : "year";

    const sub: SubscriptionInfo = {
      tier: "pro",
      status: "active",
      planName,
      billingInterval,
      licenseKey: key,
      isTrialEligible: false,
      limits: PRO_PLAN_LIMITS,
    };
    this.saveSubscription(sub);
    return sub;
  }

  resetSubscription(): SubscriptionInfo {
    const reset = { ...DEFAULT_FREE_SUBSCRIPTION };
    this.saveSubscription(reset);
    return reset;
  }

  // ---- conversations
  listConversations(): Conversation[] {
    return this.db.listConversations(this.spaceId);
  }

  getConversation(id: string) {
    const c = this.db.getConversation(id);
    return c && c.spaceId === this.spaceId ? c : null;
  }

  upsertConversation(c: Conversation) {
    const existing = this.db.getConversation(c.id);
    if (existing && existing.spaceId !== this.spaceId) throw new Error("Conversation not found");
    const next = { ...c, spaceId: this.spaceId };
    this.db.upsertConversation(next);
    this.emit({ type: "conversation.upsert", conversation: next });
  }

  deleteConversation(id: string) {
    if (!this.getConversation(id)) return;
    this.db.deleteConversation(id);
    this.emit({ type: "conversation.delete", conversationId: id });
  }

  // ---- messages
  listMessages(conversationId: string): Message[] {
    if (!this.getConversation(conversationId)) return [];
    return this.db.listMessages(conversationId);
  }

  getMessage(id: string) {
    const m = this.db.getMessage(id);
    if (!m || !this.getConversation(m.conversationId)) return null;
    return m;
  }

  upsertMessage(m: Message) {
    if (!this.getConversation(m.conversationId)) throw new Error("Conversation not found");
    this.db.upsertMessage(this.spaceId, m);
    this.emit({ type: "message.upsert", message: m });
  }

  deleteMessage(conversationId: string, id: string) {
    if (!this.getConversation(conversationId)) return;
    this.db.deleteMessage(id);
    this.emit({ type: "message.delete", messageId: id, conversationId });
  }

  deleteMessagesFrom(conversationId: string, createdAt: number) {
    if (!this.getConversation(conversationId)) return;
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
  const providerKey = Boolean(apiKey || (s.provider.kind === "deepseek" && process.env.DEEPSEEK_API_KEY));
  return {
    ...rest,
    provider: { ...provider, hasApiKey: providerKey },
    hasComposioApiKey: fromSettings || fromEnv,
    composioKeySource: fromSettings ? "settings" : fromEnv ? "env" : "none",
  };
}
