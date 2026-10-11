import { randomBytes } from "node:crypto";
import { promises as fs, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import QRCode from "qrcode";
import type { HealthInfo, PairingTicket, Platform } from "@nimbus/shared";
import { composioConnect, composioStatus } from "./composio-host.js";
import { verifySupabaseAccessToken, type SupabaseAccount } from "./supabase-auth.js";
import type { Db } from "./db.js";
import type { ServerConfig } from "./config.js";
import type { SpaceService } from "./space.js";

/** Origin a phone should open. In dev that is the Vite port; in production the server serves the UI itself. */
export function uiOrigin(cfg: ServerConfig, host: string): string {
  const port = cfg.webDist ? cfg.port : cfg.webDevPort;
  return `http://${host}:${port}`;
}

/**
 * Hosts a phone can open. A `.local` name is listed first because a home-screen
 * icon saved from a raw IP address opens inside the browser, while the same
 * icon saved from a hostname can open full screen.
 */
export function phoneHosts(): string[] {
  const hosts: string[] = [];
  const short = os.hostname().trim().replace(/\.local$/i, "");
  if (/^[A-Za-z0-9-]+$/.test(short)) hosts.push(`${short}.local`);
  for (const ip of lanAddresses()) if (!hosts.includes(ip)) hosts.push(ip);
  return hosts;
}

export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const [, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".webmanifest": "application/manifest+json", ".map": "application/json", ".txt": "text/plain",
};

function isLoopback(addr: string | undefined): boolean {
  return !!addr && /^(127\.|::1$|::ffff:127\.)/.test(addr);
}

async function googleUser(header: string | undefined): Promise<SupabaseAccount | null> {
  return verifySupabaseAccessToken(header);
}

export function createHttpApp(cfg: ServerConfig, db: Db, space: SpaceService, primaryToken: string, startedAt: number) {
  const app = new Hono<{ Bindings: { remote?: string }; Variables: { remote?: string } }>();
  app.use("*", async (c, next) => {
    if (c.env?.remote) c.set("remote", c.env.remote);
    await next();
  });
  app.use("/api/*", cors());

  app.get("/api/health", (c) => {
    const info: HealthInfo = { ok: true, version: "0.1.0", uptimeMs: Date.now() - startedAt, dataDir: cfg.dataDir, lanUrls: phoneHosts().map((host) => uiOrigin(cfg, host)) };
    return c.json(info);
  });

  /** Loopback-only: hands the primary device token to the desktop shell / local browser. */
  app.get("/api/bootstrap", async (c) => {
    const remote = c.get("remote");
    if (!isLoopback(remote)) return c.json({ error: "bootstrap is only available from this machine" }, 403);
    const user = await googleUser(c.req.header("x-supabase-token"));
    if (!user) return c.json({ error: "Sign in with Google first" }, 401);
    const conflict = db.claimAccount(space.spaceId, user);
    if (conflict) return c.json({ error: conflict }, 403);
    const dev = db.deviceByToken(primaryToken);
    return c.json({ token: primaryToken, deviceId: dev?.id, spaceId: space.spaceId });
  });

  /** Create a pairing ticket (QR + 6-digit code). Requires a valid device token. */
  app.post("/api/pair/create", async (c) => {
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const dev = token ? db.deviceByToken(token) : null;
    if (!dev) return c.json({ error: "unauthorized" }, 401);
    const { code, expiresAt } = db.createPairing(space.spaceId);
    const hostHeader = (c.req.header("host") ?? `localhost:${cfg.port}`).split(":")[0];
    const hosts = phoneHosts();
    const base = uiOrigin(cfg, hosts[0] ?? hostHeader);
    const url = `${base}/#/pair/${code}`;
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#0b0b0f", light: "#ffffff" } });
    const ticket: PairingTicket & { qr: string; lanUrls: string[] } = { code, url, expiresAt, qr, lanUrls: hosts.map((host) => uiOrigin(cfg, host)) };
    return c.json(ticket);
  });

  const authed = (header: string | undefined) => {
    const token = header?.replace(/^Bearer\s+/i, "");
    const dev = token ? db.deviceByToken(token) : null;
    return dev && dev.spaceId === space.spaceId ? dev : null;
  };

  /** Connected-app catalog. The API key never leaves the host. */
  app.get("/api/composio/apps", async (c) => {
    if (!authed(c.req.header("authorization"))) return c.json({ error: "unauthorized" }, 401);
    return c.json(await composioStatus(space));
  });

  app.post("/api/composio/connect", async (c) => {
    if (!authed(c.req.header("authorization"))) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { toolkit?: string };
    const toolkit = String(body.toolkit ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,64}$/.test(toolkit)) return c.json({ error: "Enter an app slug such as gmail or github." }, 400);
    try {
      const result = await composioConnect(space, toolkit);
      if (!result.redirectUrl) return c.json({ error: "Composio did not return a connect link for that app." }, 502);
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start the connection";
      return c.json({ error: message.slice(0, 300) }, 400);
    }
  });

  /** Bind the signed-in Google account to a space that this device already belongs to. */
  app.post("/api/account/claim", async (c) => {
    const dev = authed(c.req.header("authorization"));
    if (!dev) return c.json({ error: "unauthorized" }, 401);
    const user = await googleUser(c.req.header("x-supabase-token"));
    if (!user) return c.json({ error: "Sign in with Google first" }, 401);
    const conflict = db.claimAccount(dev.spaceId, user);
    if (conflict) return c.json({ error: conflict }, 403);
    return c.json({ email: user.email, name: user.name });
  });

  /** Exchange a pairing code for a device token (called by the phone). */
  app.post("/api/pair/claim", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { code?: string; deviceName?: string; platform?: Platform };
    const code = String(body.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) return c.json({ error: "Enter the 6-digit code shown on your desktop" }, 400);
    const user = await googleUser(c.req.header("x-supabase-token"));
    if (!user) return c.json({ error: "Sign in with Google first" }, 401);
    const spaceId = db.findPairing(code);
    if (!spaceId) return c.json({ error: "That code is invalid or has expired. Generate a new one on the desktop." }, 400);
    const conflict = db.claimAccount(spaceId, user);
    if (conflict) return c.json({ error: conflict }, 403);
    if (!db.claimPairing(code)) return c.json({ error: "That code is invalid or has expired. Generate a new one on the desktop." }, 400);
    const token = randomBytes(32).toString("hex");
    const device = db.createDevice(spaceId, (body.deviceName ?? "Mobile").slice(0, 60), body.platform ?? "mobile", token);
    space.deviceUpserted(device);
    return c.json({ token, deviceId: device.id, spaceId });
  });

  /** Static web client (production). */
  if (cfg.webDist && existsSync(cfg.webDist)) {
    const root = cfg.webDist;
    app.get("*", async (c) => {
      const url = new URL(c.req.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel.includes("..")) return c.text("Not found", 404);
      let file = path.join(root, rel);
      if (!existsSync(file) || (await fs.stat(file)).isDirectory()) file = path.join(root, "index.html");
      const data = await fs.readFile(file).catch(() => null);
      if (!data) return c.text("Not found", 404);
      const ext = path.extname(file);
      const immutable = /\/assets\//.test(file);
      return new Response(new Uint8Array(data), { headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" } });
    });
  } else {
    app.get("/", (c) => {
      const host = (c.req.header("host") ?? "127.0.0.1").split(":")[0];
      return c.redirect(uiOrigin(cfg, host) + "/");
    });
  }

  return app;
}
