import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs, existsSync, readFileSync } from "node:fs";
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
import type { SpaceRegistry } from "./registry.js";

/** Origin a phone should open. In dev that is the Vite port; in production the server serves the UI itself. */
export function uiOrigin(cfg: ServerConfig, host: string): string {
  const port = cfg.webDist ? cfg.port : cfg.webDevPort;
  return `http://${host}:${port}`;
}

const VIRTUAL_IFACE = /^(docker|br-|veth|virbr|vmnet|vboxnet|utun|awdl|llw|bridge|zt|tailscale|cni|flannel|cali|wg|tun|tap|lo)/i;

/** Private IPv4 a phone on the same Wi-Fi can open. Skips localhost and link-local. */
export function isLanIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((part) => Number(part));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function lanRank(ip: string): number {
  if (ip.startsWith("192.168.")) return 0;
  if (ip.startsWith("10.")) return 1;
  return 2;
}

/** Wi-Fi and Ethernet addresses, with home-network ranges ahead of bridge networks. */
export function lanAddresses(): string[] {
  const found: { address: string; rank: number }[] = [];
  for (const [iface, addrs] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL_IFACE.test(iface)) continue;
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal && isLanIPv4(a.address)) found.push({ address: a.address, rank: lanRank(a.address) });
    }
  }
  found.sort((a, b) => a.rank - b.rank);
  return [...new Set(found.map((item) => item.address))];
}

/** The address this computer uses to reach the network, when that address is on the LAN. */
function defaultRouteAddress(): string | null {
  try {
    if (process.platform === "linux") {
      const text = readFileSync("/proc/net/route", "utf8");
      for (const line of text.trim().split("\n").slice(1)) {
        const [iface, dest] = line.trim().split(/\s+/);
        if (dest !== "00000000" || !iface || VIRTUAL_IFACE.test(iface)) continue;
        const addr = (os.networkInterfaces()[iface] ?? []).find((a) => a.family === "IPv4" && isLanIPv4(a.address));
        if (addr) return addr.address;
      }
      return null;
    }
    if (process.platform === "darwin") {
      const info = execFileSync("/sbin/route", ["-n", "get", "default"], { encoding: "utf8", timeout: 1500 });
      const iface = /^interface:\s*(\S+)/m.exec(info)?.[1];
      if (!iface || VIRTUAL_IFACE.test(iface)) return null;
      const addr = execFileSync("/usr/sbin/ipconfig", ["getifaddr", iface], { encoding: "utf8", timeout: 1500 }).trim();
      return isLanIPv4(addr) ? addr : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Addresses a phone can open. The Wi-Fi address is first because that is what a
 * scanned QR code must open. A `.local` name is last: it is useful for a home-screen
 * icon, and it is a different site from the Wi-Fi address.
 */
export function phoneHosts(): string[] {
  const ips = lanAddresses();
  const preferred = defaultRouteAddress();
  const ordered = preferred ? [preferred, ...ips.filter((ip) => ip !== preferred)] : ips;
  const hosts = [...ordered];
  const short = os.hostname().trim().replace(/\.local$/i, "");
  if (/^[A-Za-z0-9-]+$/.test(short)) hosts.push(`${short}.local`);
  return hosts;
}

/** Address encoded in the pairing QR. Never localhost and never the `.local` name. */
export function wifiHost(): string | null {
  return phoneHosts().find((host) => isLanIPv4(host)) ?? null;
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

export function createHttpApp(cfg: ServerConfig, db: Db, registry: SpaceRegistry, startedAt: number) {
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

  /** Loopback-only: opens this Google account's space and returns its desktop token. */
  app.get("/api/bootstrap", async (c) => {
    const remote = c.get("remote");
    if (!isLoopback(remote)) return c.json({ error: "bootstrap is only available from this machine" }, 403);
    const user = await googleUser(c.req.header("x-supabase-token"));
    if (!user) return c.json({ error: "Sign in with Google first" }, 401);
    try {
      return c.json(registry.ensureUserSpace(user));
    } catch (error) {
      console.error("[nimbus] bootstrap failed", error instanceof Error ? error.message : "unknown");
      return c.json({ error: "Could not open your account" }, 500);
    }
  });

  /** Create a pairing ticket (QR + 6-digit code). Requires a valid device token. */
  app.post("/api/pair/create", async (c) => {
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const dev = token ? db.deviceByToken(token) : null;
    if (!dev) return c.json({ error: "unauthorized" }, 401);
    const wifi = wifiHost();
    if (!wifi) return c.json({ error: "This computer has no Wi‑Fi address. Join the same network as the phone, then generate a new code." }, 409);
    const { code, expiresAt } = db.createPairing(dev.spaceId);
    const hosts = phoneHosts();
    const url = `${uiOrigin(cfg, wifi)}/#/pair/${code}`;
    const qr = await QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#0b0b0f", light: "#ffffff" } });
    const ticket: PairingTicket & { qr: string; lanUrls: string[] } = { code, url, expiresAt, qr, lanUrls: hosts.map((host) => uiOrigin(cfg, host)) };
    return c.json(ticket);
  });

  const authed = (header: string | undefined) => {
    const token = header?.replace(/^Bearer\s+/i, "");
    return token ? db.deviceByToken(token) : null;
  };

  /** Connected-app catalog. The API key never leaves the host. */
  app.get("/api/composio/apps", async (c) => {
    const dev = authed(c.req.header("authorization"));
    if (!dev) return c.json({ error: "unauthorized" }, 401);
    return c.json(await composioStatus(registry.get(dev.spaceId).space));
  });

  app.post("/api/composio/connect", async (c) => {
    const dev = authed(c.req.header("authorization"));
    if (!dev) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { toolkit?: string };
    const toolkit = String(body.toolkit ?? "").trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,64}$/.test(toolkit)) return c.json({ error: "Enter an app slug such as gmail or github." }, 400);
    try {
      const result = await composioConnect(registry.get(dev.spaceId).space, toolkit);
      if (!result.redirectUrl) return c.json({ error: "Composio did not return a connect link for that app." }, 502);
      return c.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start the connection";
      return c.json({ error: message.slice(0, 300) }, 400);
    }
  });

  /** Bind an existing device token to the signed-in Google account, or refuse a mismatch. */
  app.post("/api/account/claim", async (c) => {
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const user = await googleUser(c.req.header("x-supabase-token"));
    if (!user) return c.json({ error: "Sign in with Google first" }, 401);
    const claimed = registry.claimDevice(user, token);
    if (!claimed.ok) return c.json({ error: claimed.error }, claimed.status);
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
    const denied = registry.pairingDenial(spaceId, user.id);
    if (denied) return c.json({ error: denied }, 403);
    const conflict = db.bindAccount(spaceId, user);
    if (conflict) return c.json({ error: conflict }, 403);
    if (!db.claimPairing(code)) return c.json({ error: "That code is invalid or has expired. Generate a new one on the desktop." }, 400);
    const token = randomBytes(32).toString("hex");
    const device = db.createDevice(spaceId, (body.deviceName ?? "Mobile").slice(0, 60), body.platform ?? "mobile", token);
    registry.get(spaceId).space.deviceUpserted(device);
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
