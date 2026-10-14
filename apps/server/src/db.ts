import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Conversation, Device, Message, Platform, SpaceSettings, SubscriptionInfo } from "@nimbus/shared";
import type { PersistedEvent, SyncEvent } from "@nimbus/shared";
import { DEFAULT_FREE_SUBSCRIPTION, normalizeSubscription, newId } from "@nimbus/shared";
import { DEFAULT_MODELS } from "@nimbus/agent-core";

const EVENT_RETENTION = 20_000;

export const DEFAULT_SETTINGS = (workspacePath: string): SpaceSettings => ({
  provider: { kind: "deepseek", baseUrl: DEFAULT_MODELS.deepseek.baseUrl, model: DEFAULT_MODELS.deepseek.model, serverTools: false },
  permissionMode: "ask",
  workspacePath,
  memoryEnabled: true,
  subagentsEnabled: true,
  webSearchEnabled: true,
  mcpServers: [],
  allowRules: ["Read(*)", "Grep(*)", "WebFetch(*)"],
  denyRules: ["Bash(rm -rf /*)", "Bash(git push --force*)"],
  systemPromptAddendum: "",
  composioEnabled: true,
});

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class Db {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    this.db = new DatabaseSync(path.join(dataDir, "nimbus.sqlite"));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, space_id TEXT NOT NULL, name TEXT NOT NULL, platform TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 0, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, space_id TEXT NOT NULL, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS conversations_space ON conversations(space_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, space_id TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, created_at);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, space_id TEXT NOT NULL, at INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_space ON events(space_id, seq);
      CREATE TABLE IF NOT EXISTS settings (space_id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS subscriptions (space_id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pairings (code TEXT PRIMARY KEY, space_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (
        space_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT, name TEXT, avatar TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS accounts_user ON accounts(user_id);
      CREATE TABLE IF NOT EXISTS todos (conversation_id TEXT PRIMARY KEY, json TEXT NOT NULL);
    `);
  }

  // ---- spaces & devices -------------------------------------------------

  createSpace(spaceId: string, name: string, workspacePath: string) {
    this.db.prepare("INSERT INTO spaces (id, name, created_at) VALUES (?, ?, ?)").run(spaceId, name.slice(0, 80), Date.now());
    this.db.prepare("INSERT INTO settings (space_id, json) VALUES (?, ?)").run(spaceId, JSON.stringify(DEFAULT_SETTINGS(workspacePath)));
    this.db.prepare("INSERT INTO subscriptions (space_id, json) VALUES (?, ?)").run(spaceId, JSON.stringify(DEFAULT_FREE_SUBSCRIPTION));
  }

  hasSpace(id: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM spaces WHERE id = ?").get(id));
  }

  hasPrimaryDevice(spaceId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM devices WHERE space_id = ? AND is_primary = 1").get(spaceId));
  }

  createDevice(spaceId: string, name: string, platform: Platform, token: string, primary = false): Device {
    const now = Date.now();
    const id = newId("dev");
    this.db.prepare("INSERT INTO devices (id, space_id, name, platform, is_primary, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, spaceId, name, platform, primary ? 1 : 0, hashToken(token), now, now);
    return { id, spaceId, name, platform, primary, createdAt: now, lastSeenAt: now };
  }

  deviceByToken(token: string): Device | null {
    const r = this.db.prepare("SELECT * FROM devices WHERE token_hash = ?").get(hashToken(token)) as any;
    return r ? rowToDevice(r) : null;
  }

  deviceById(id: string): Device | null {
    const r = this.db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as any;
    return r ? rowToDevice(r) : null;
  }

  listDevices(spaceId: string): Device[] {
    return (this.db.prepare("SELECT * FROM devices WHERE space_id = ? ORDER BY is_primary DESC, created_at").all(spaceId) as any[]).map(rowToDevice);
  }

  touchDevice(id: string) {
    this.db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(Date.now(), id);
  }

  renameDevice(id: string, name: string) {
    this.db.prepare("UPDATE devices SET name = ? WHERE id = ?").run(name, id);
  }

  deleteDevice(id: string) {
    this.db.prepare("DELETE FROM devices WHERE id = ? AND is_primary = 0").run(id);
  }

  // ---- pairing ------------------------------------------------------------

  createPairing(spaceId: string, ttlMs = 5 * 60_000): { code: string; expiresAt: number } {
    this.db.prepare("DELETE FROM pairings WHERE expires_at < ?").run(Date.now());
    let code: string;
    do {
      code = String(Math.floor(100000 + Math.random() * 900000));
    } while (this.db.prepare("SELECT 1 FROM pairings WHERE code = ?").get(code));
    const expiresAt = Date.now() + ttlMs;
    this.db.prepare("INSERT INTO pairings (code, space_id, expires_at) VALUES (?, ?, ?)").run(code, spaceId, expiresAt);
    return { code, expiresAt };
  }

  findPairing(code: string): string | null {
    const r = this.db.prepare("SELECT space_id, expires_at FROM pairings WHERE code = ?").get(code) as { space_id: string; expires_at: number } | undefined;
    if (!r || r.expires_at < Date.now()) return null;
    return r.space_id;
  }

  claimPairing(code: string): string | null {
    const r = this.db.prepare("SELECT space_id, expires_at FROM pairings WHERE code = ?").get(code) as { space_id: string; expires_at: number } | undefined;
    if (!r) return null;
    this.db.prepare("DELETE FROM pairings WHERE code = ?").run(code);
    if (r.expires_at < Date.now()) return null;
    return r.space_id;
  }

  accountByUser(userId: string): AccountRecord | null {
    const r = this.db.prepare("SELECT space_id, user_id, email, name, avatar FROM accounts WHERE user_id = ?").get(userId) as AccountSql | undefined;
    return r ? rowToAccount(r) : null;
  }

  accountBySpace(spaceId: string): AccountRecord | null {
    const r = this.db.prepare("SELECT space_id, user_id, email, name, avatar FROM accounts WHERE space_id = ?").get(spaceId) as AccountSql | undefined;
    return r ? rowToAccount(r) : null;
  }

  listAccounts(): AccountRecord[] {
    const rows = this.db.prepare("SELECT space_id, user_id, email, name, avatar FROM accounts").all() as AccountSql[];
    return rows.map(rowToAccount);
  }

  /**
   * Bind this Google user to this space.
   * A space keeps the first account that claimed it, and a user keeps the first space they claimed.
   * Returns an error message when the bind would cross accounts.
   */
  bindAccount(spaceId: string, user: { id: string; email: string | null; name: string | null; avatar: string | null }): string | null {
    const byUser = this.accountByUser(user.id);
    if (byUser && byUser.spaceId !== spaceId) return "This Google account already has its own Nimbus. Sign in on this computer to open it.";
    const bySpace = this.accountBySpace(spaceId);
    if (bySpace && bySpace.userId !== user.id) {
      const who = bySpace.email?.trim() || "another Google account";
      return `This Nimbus is signed in as ${who}. Use that account.`;
    }
    this.db.prepare(
      "INSERT INTO accounts (space_id, user_id, email, name, avatar) VALUES (?, ?, ?, ?, ?) ON CONFLICT(space_id) DO UPDATE SET email = excluded.email, name = excluded.name, avatar = excluded.avatar",
    ).run(spaceId, user.id, user.email, user.name, user.avatar);
    return null;
  }

  // ---- settings -----------------------------------------------------------

  getSettings(spaceId: string, defaultWorkspace: string): SpaceSettings {
    const r = this.db.prepare("SELECT json FROM settings WHERE space_id = ?").get(spaceId) as { json: string } | undefined;
    const base = DEFAULT_SETTINGS(defaultWorkspace);
    if (!r) return base;
    const parsed = JSON.parse(r.json) as Partial<SpaceSettings>;
    const provider = { ...base.provider, ...(parsed.provider ?? {}) };
    // Spaces created before DeepSeek was the default still have the factory demo provider.
    const untouchedDemo = provider.kind === "mock" && !provider.apiKey && provider.model === "grok-4-1-fast-reasoning";
    return { ...base, ...parsed, provider: untouchedDemo ? base.provider : provider };
  }

  saveSettings(spaceId: string, settings: SpaceSettings) {
    this.db.prepare("INSERT INTO settings (space_id, json) VALUES (?, ?) ON CONFLICT(space_id) DO UPDATE SET json = excluded.json").run(spaceId, JSON.stringify(settings));
  }

  // ---- subscription & billing ---------------------------------------------

  getSubscription(spaceId: string): SubscriptionInfo {
    const r = this.db.prepare("SELECT json FROM subscriptions WHERE space_id = ?").get(spaceId) as { json: string } | undefined;
    if (!r) {
      const initial = { ...DEFAULT_FREE_SUBSCRIPTION };
      this.saveSubscription(spaceId, initial);
      return initial;
    }
    try {
      const parsed = JSON.parse(r.json) as Partial<SubscriptionInfo>;
      const current = normalizeSubscription(parsed);
      if (parsed.status !== current.status || parsed.tier !== current.tier) {
        this.saveSubscription(spaceId, current);
      }
      return current;
    } catch {
      return { ...DEFAULT_FREE_SUBSCRIPTION };
    }
  }

  saveSubscription(spaceId: string, sub: SubscriptionInfo) {
    this.db.prepare("INSERT INTO subscriptions (space_id, json) VALUES (?, ?) ON CONFLICT(space_id) DO UPDATE SET json = excluded.json")
      .run(spaceId, JSON.stringify(sub));
  }

  // ---- conversations & messages -----------------------------------------

  listConversations(spaceId: string): Conversation[] {
    return (this.db.prepare("SELECT json FROM conversations WHERE space_id = ? ORDER BY updated_at DESC").all(spaceId) as { json: string }[]).map((r) => JSON.parse(r.json));
  }

  getConversation(id: string): Conversation | null {
    const r = this.db.prepare("SELECT json FROM conversations WHERE id = ?").get(id) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : null;
  }

  upsertConversation(c: Conversation) {
    this.db.prepare("INSERT INTO conversations (id, space_id, json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
      .run(c.id, c.spaceId, JSON.stringify(c), c.updatedAt);
  }

  deleteConversation(id: string) {
    this.db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM todos WHERE conversation_id = ?").run(id);
    this.db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  }

  listMessages(conversationId: string): Message[] {
    return (this.db.prepare("SELECT json FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid").all(conversationId) as { json: string }[]).map((r) => JSON.parse(r.json));
  }

  getMessage(id: string): Message | null {
    const r = this.db.prepare("SELECT json FROM messages WHERE id = ?").get(id) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : null;
  }

  upsertMessage(spaceId: string, m: Message) {
    this.db.prepare("INSERT INTO messages (id, conversation_id, space_id, json, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json")
      .run(m.id, m.conversationId, spaceId, JSON.stringify(m), m.createdAt);
  }

  deleteMessage(id: string) {
    this.db.prepare("DELETE FROM messages WHERE id = ?").run(id);
  }

  deleteMessagesFrom(conversationId: string, createdAt: number): string[] {
    const ids = (this.db.prepare("SELECT id FROM messages WHERE conversation_id = ? AND created_at >= ?").all(conversationId, createdAt) as { id: string }[]).map((r) => r.id);
    this.db.prepare("DELETE FROM messages WHERE conversation_id = ? AND created_at >= ?").run(conversationId, createdAt);
    return ids;
  }

  getTodos(conversationId: string) {
    const r = this.db.prepare("SELECT json FROM todos WHERE conversation_id = ?").get(conversationId) as { json: string } | undefined;
    return r ? JSON.parse(r.json) : [];
  }

  saveTodos(conversationId: string, todos: unknown) {
    this.db.prepare("INSERT INTO todos (conversation_id, json) VALUES (?, ?) ON CONFLICT(conversation_id) DO UPDATE SET json = excluded.json").run(conversationId, JSON.stringify(todos));
  }

  // ---- event log ----------------------------------------------------------

  appendEvent(spaceId: string, event: SyncEvent): PersistedEvent {
    const at = Date.now();
    const res = this.db.prepare("INSERT INTO events (space_id, at, json) VALUES (?, ?, ?)").run(spaceId, at, JSON.stringify(event));
    const seq = Number(res.lastInsertRowid);
    if (seq % 500 === 0) {
      this.db.prepare("DELETE FROM events WHERE space_id = ? AND seq < ?").run(spaceId, seq - EVENT_RETENTION);
    }
    return { seq, at, event };
  }

  eventsSince(spaceId: string, since: number, limit = 5000): { events: PersistedEvent[]; oldest: number; latest: number } {
    const bounds = this.db.prepare("SELECT MIN(seq) AS oldest, MAX(seq) AS latest FROM events WHERE space_id = ?").get(spaceId) as { oldest: number | null; latest: number | null };
    const rows = this.db.prepare("SELECT seq, at, json FROM events WHERE space_id = ? AND seq > ? ORDER BY seq LIMIT ?").all(spaceId, since, limit) as { seq: number; at: number; json: string }[];
    return { events: rows.map((r) => ({ seq: r.seq, at: r.at, event: JSON.parse(r.json) })), oldest: bounds.oldest ?? 0, latest: bounds.latest ?? 0 };
  }

  latestSeq(spaceId: string): number {
    const r = this.db.prepare("SELECT MAX(seq) AS latest FROM events WHERE space_id = ?").get(spaceId) as { latest: number | null };
    return r.latest ?? 0;
  }

  close() {
    this.db.close();
  }
}

function rowToDevice(r: any): Device {
  return { id: r.id, spaceId: r.space_id, name: r.name, platform: r.platform, primary: Boolean(r.is_primary), createdAt: r.created_at, lastSeenAt: r.last_seen_at };
}

export interface AccountRecord {
  spaceId: string;
  userId: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
}

interface AccountSql {
  space_id: string;
  user_id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
}

function rowToAccount(r: AccountSql): AccountRecord {
  return { spaceId: r.space_id, userId: r.user_id, email: r.email, name: r.name, avatar: r.avatar };
}
