import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Conversation, Device, Message, Platform, SpaceSettings } from "@nimbus/shared";
import type { PersistedEvent, SyncEvent } from "@nimbus/shared";
import { newId } from "@nimbus/shared";
import { DEFAULT_MODELS } from "@nimbus/agent-core";

const EVENT_RETENTION = 20_000;

export const DEFAULT_SETTINGS = (workspacePath: string): SpaceSettings => ({
  provider: { kind: "mock", baseUrl: DEFAULT_MODELS.xai.baseUrl, model: DEFAULT_MODELS.xai.model, serverTools: true },
  permissionMode: "ask",
  workspacePath,
  memoryEnabled: true,
  subagentsEnabled: true,
  webSearchEnabled: true,
  mcpServers: [],
  allowRules: ["Read(*)", "Grep(*)", "WebFetch(*)"],
  denyRules: ["Bash(rm -rf /*)", "Bash(git push --force*)"],
  systemPromptAddendum: "",
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
      CREATE TABLE IF NOT EXISTS pairings (code TEXT PRIMARY KEY, space_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS todos (conversation_id TEXT PRIMARY KEY, json TEXT NOT NULL);
    `);
  }

  // ---- spaces & devices -------------------------------------------------

  ensurePrimarySpace(defaultWorkspace: string): { spaceId: string; primaryToken: string | null } {
    const row = this.db.prepare("SELECT id FROM spaces ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
    if (row) return { spaceId: row.id, primaryToken: null };
    const spaceId = newId("space");
    this.db.prepare("INSERT INTO spaces (id, name, created_at) VALUES (?, ?, ?)").run(spaceId, "Personal", Date.now());
    this.db.prepare("INSERT INTO settings (space_id, json) VALUES (?, ?)").run(spaceId, JSON.stringify(DEFAULT_SETTINGS(defaultWorkspace)));
    return { spaceId, primaryToken: null };
  }

  /** The primary (desktop host) device token, created on first run and persisted hashed. */
  getOrCreatePrimaryDevice(spaceId: string, name: string, platform: Platform, tokenFile: { read(): string | null; write(t: string): void }): { device: Device; token: string } {
    const existingToken = tokenFile.read();
    if (existingToken) {
      const dev = this.deviceByToken(existingToken);
      if (dev) return { device: dev, token: existingToken };
    }
    const token = randomBytes(32).toString("hex");
    const device = this.createDevice(spaceId, name, platform, token, true);
    tokenFile.write(token);
    return { device, token };
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

  claimPairing(code: string): string | null {
    const r = this.db.prepare("SELECT space_id, expires_at FROM pairings WHERE code = ?").get(code) as { space_id: string; expires_at: number } | undefined;
    if (!r) return null;
    this.db.prepare("DELETE FROM pairings WHERE code = ?").run(code);
    if (r.expires_at < Date.now()) return null;
    return r.space_id;
  }

  // ---- settings -----------------------------------------------------------

  getSettings(spaceId: string, defaultWorkspace: string): SpaceSettings {
    const r = this.db.prepare("SELECT json FROM settings WHERE space_id = ?").get(spaceId) as { json: string } | undefined;
    const base = DEFAULT_SETTINGS(defaultWorkspace);
    if (!r) return base;
    const parsed = JSON.parse(r.json) as Partial<SpaceSettings>;
    return { ...base, ...parsed, provider: { ...base.provider, ...(parsed.provider ?? {}) } };
  }

  saveSettings(spaceId: string, settings: SpaceSettings) {
    this.db.prepare("INSERT INTO settings (space_id, json) VALUES (?, ?) ON CONFLICT(space_id) DO UPDATE SET json = excluded.json").run(spaceId, JSON.stringify(settings));
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
