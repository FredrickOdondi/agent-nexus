import { promises as fs, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import QRCode from "qrcode";
import type { HealthInfo, PairingTicket, Platform } from "@nimbus/shared";
import type { Db } from "./db.js";
import type { ServerConfig } from "./config.js";
import type { SpaceService } from "./space.js";

/** Origin a phone should open. In dev that is the Vite port; in production the server serves the UI itself. */
export function uiOrigin(cfg: ServerConfig, host: string): string {
  const port = cfg.webDist ? cfg.port : cfg.webDevPort;
  return `http://${host}:${port}`;
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

export function createHttpApp(cfg: ServerConfig, db: Db, space: SpaceService, primaryToken: string, startedAt: number) {
  const app = new Hono<{ Bindings: { remote?: string }; Variables: { remote?: string } }>();
  app.use("*", async (c, next) => {
    if (c.env?.remote) c.set("remote", c.env.remote);
    await next();
  });
  app.use("/api/*", cors());

  app.get("/api/health", (c) => {
    const info: HealthInfo = { ok: true, version: "0.1.0", uptimeMs: Date.now() - startedAt, dataDir: cfg.dataDir, lanUrls: lanAddresses().map((ip) => uiOrigin(cfg, ip)) };
    return c.json(info);
  });

  /** Loopback-only: hands the primary device token to the desktop shell / local browser. */
  app.get("/api/bootstrap", (c) => {
    const remote = c.get("remote");
    if (!isLoopback(remote)) return c.json({ error: "bootstrap is only available from this machine" }, 403);
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
    const lan = lanAddresses()[0];
    const base = uiOrigin(cfg, lan ?? hostHeader);
    const url = `${base}/#/pair/${code}`;
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#0b0b0f", light: "#ffffff" } });
    const ticket: PairingTicket & { qr: string; lanUrls: string[] } = { code, url, expiresAt, qr, lanUrls: lanAddresses().map((ip) => uiOrigin(cfg, ip)) };
    return c.json(ticket);
  });

  /** Exchange a pairing code for a device token (called by the phone). */
  app.post("/api/pair/claim", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { code?: string; deviceName?: string; platform?: Platform };
    const code = String(body.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) return c.json({ error: "Enter the 6-digit code shown on your desktop" }, 400);
    const spaceId = db.claimPairing(code);
    if (!spaceId) return c.json({ error: "That code is invalid or has expired. Generate a new one on the desktop." }, 400);
    const token = (await import("node:crypto")).randomBytes(32).toString("hex");
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
