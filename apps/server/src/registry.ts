import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { newId } from "@nimbus/shared";
import type { ServerConfig } from "./config.js";
import type { Db } from "./db.js";
import { RunManager } from "./runs.js";
import { SpaceService } from "./space.js";
import type { SupabaseAccount } from "./supabase-auth.js";

export interface SpaceRuntime {
  space: SpaceService;
  runs: RunManager;
}

export interface LinkedDevice {
  token: string;
  deviceId: string;
  spaceId: string;
}

/**
 * One Google account owns one space. Device tokens are stored hashed in
 * sqlite; the raw desktop token for each account lives in a mode-0600 file
 * so a later sign-in on this computer can reopen that space.
 */
export class SpaceRegistry {
  private runtimes = new Map<string, SpaceRuntime>();
  private listeners = new Set<(rt: SpaceRuntime) => void>();
  private accountListeners = new Set<(userId: string, spaceId: string) => void>();
  private readonly tokenFile: string;

  constructor(
    private db: Db,
    private cfg: ServerConfig,
    private log: (level: string, msg: string, extra?: unknown) => void,
  ) {
    this.tokenFile = path.join(cfg.dataDir, "user-device-tokens.json");
  }

  get dataDir(): string {
    return this.cfg.dataDir;
  }

  /** Subscribe to account binds so relays can join remote channels immediately */
  onAccount(fn: (userId: string, spaceId: string) => void) {
    this.accountListeners.add(fn);
    return () => this.accountListeners.delete(fn);
  }

  emitAccountBound(userId: string, spaceId: string) {
    for (const l of this.accountListeners) l(userId, spaceId);
  }

  /** Hub subscribes so events from a space reach only that space's sockets. */
  onSpace(fn: (rt: SpaceRuntime) => void) {
    this.listeners.add(fn);
    for (const rt of this.runtimes.values()) fn(rt);
    return () => this.listeners.delete(fn);
  }

  get(spaceId: string): SpaceRuntime {
    let rt = this.runtimes.get(spaceId);
    if (!rt) {
      const settings = this.db.getSettings(spaceId, this.cfg.defaultWorkspace);
      const space = new SpaceService(this.db, spaceId, settings.workspacePath || this.cfg.defaultWorkspace);
      const runs = new RunManager(space, this.cfg.dataDir, this.cfg.platformName, this.log);
      rt = { space, runs };
      this.runtimes.set(spaceId, rt);
      for (const l of this.listeners) l(rt);
    }
    return rt;
  }

  /**
   * Open the space that belongs to this Google user, creating an empty one
   * when they have never signed in on this computer.
   */
  ensureUserSpace(user: SupabaseAccount): LinkedDevice {
    const existing = this.db.accountByUser(user.id);
    if (existing) {
      this.db.bindAccount(existing.spaceId, user);
      this.emitAccountBound(user.id, existing.spaceId);
      const saved = this.tokens()[user.id];
      if (saved) {
        const dev = this.db.deviceByToken(saved);
        if (dev && dev.spaceId === existing.spaceId) {
          this.get(existing.spaceId);
          return { token: saved, deviceId: dev.id, spaceId: existing.spaceId };
        }
      }
      return this.issueDesktopToken(existing.spaceId, user.id);
    }

    const spaceId = newId("space");
    const workspace = path.join(this.cfg.dataDir, "spaces", spaceId);
    mkdirSync(workspace, { recursive: true });
    const name = user.name?.trim() || user.email?.split("@")[0] || "Personal";
    this.db.createSpace(spaceId, name, workspace);
    const conflict = this.db.bindAccount(spaceId, user);
    if (conflict) throw new Error(conflict);
    this.emitAccountBound(user.id, spaceId);
    this.log("info", "created space for google account", spaceId);
    return this.issueDesktopToken(spaceId, user.id);
  }

  /**
   * The browser presented a device token it already holds.
   * An unowned space is bound to this user (so the original desktop keeps its chats).
   * A space owned by someone else is refused.
   */
  claimDevice(user: SupabaseAccount, rawToken: string): { ok: true } | { ok: false; status: 401 | 403; error: string } {
    const dev = this.db.deviceByToken(rawToken);
    if (!dev) return { ok: false, status: 401, error: "unauthorized" };
    const conflict = this.db.bindAccount(dev.spaceId, user);
    if (conflict) return { ok: false, status: 403, error: conflict };
    this.emitAccountBound(user.id, dev.spaceId);
    if (dev.primary) this.rememberToken(user.id, rawToken);
    this.get(dev.spaceId);
    return { ok: true };
  }

  /** Pairing joins an existing account. It never attaches a second Google user to the space. */
  pairingDenial(spaceId: string, userId: string): string | null {
    const owner = this.db.accountBySpace(spaceId);
    if (!owner) return "Sign in on the computer that showed this code, then generate a new one.";
    if (owner.userId !== userId) {
      const who = owner.email?.trim() || "another Google account";
      return `This code belongs to ${who}. Sign in with that Google account.`;
    }
    return null;
  }

  private issueDesktopToken(spaceId: string, userId: string): LinkedDevice {
    const token = randomBytes(32).toString("hex");
    const primary = !this.db.hasPrimaryDevice(spaceId);
    const device = this.db.createDevice(spaceId, this.cfg.platformName, "desktop", token, primary);
    this.rememberToken(userId, token);
    this.get(spaceId).space.deviceUpserted(device);
    return { token, deviceId: device.id, spaceId };
  }

  private rememberToken(userId: string, token: string) {
    const map = this.tokens();
    map[userId] = token;
    writeFileSync(this.tokenFile, JSON.stringify(map), { mode: 0o600 });
    try { chmodSync(this.tokenFile, 0o600); } catch { /* windows */ }
  }

  private tokens(): Record<string, string> {
    try {
      const parsed = JSON.parse(readFileSync(this.tokenFile, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object") return {};
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) if (typeof v === "string" && v) out[k] = v;
      return out;
    } catch {
      return {};
    }
  }
}
