import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import QRCode from "qrcode";
import type { HealthInfo, PairingTicket, Platform, SubscriptionInfo } from "@nimbus/shared";
import { FREE_PLAN_LIMITS, PRO_PLAN_LIMITS } from "@nimbus/shared";
import { composioConnect, composioStatus } from "./composio-host.js";
import { verifySupabaseAccessToken, type SupabaseAccount } from "./supabase-auth.js";
import {
  convertPlanPrice,
  getUsdToKesRate,
  initializePaystackTransaction,
  PLAN_PRICING_USD,
  verifyPaystackTransaction,
  verifyPaystackWebhookSignature,
} from "./paystack.js";
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
  if (typeof ip !== "string" || !ip) return false;
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
  let interfaces: ReturnType<typeof os.networkInterfaces>;
  try {
    interfaces = os.networkInterfaces();
  } catch {
    return [];
  }
  const found: { address: string; rank: number }[] = [];
  for (const [iface, addrs] of Object.entries(interfaces ?? {})) {
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
export function phoneHosts(cfg?: { lanBound?: boolean }): string[] {
  if (cfg?.lanBound === false) return [];
  const ips = lanAddresses();
  const preferred = defaultRouteAddress();
  const ordered = preferred ? [preferred, ...ips.filter((ip) => ip !== preferred)] : ips;
  const hosts = [...ordered];
  const short = os.hostname().trim().replace(/\.local$/i, "");
  if (/^[A-Za-z0-9-]+$/.test(short)) hosts.push(`${short}.local`);
  return hosts;
}

/** Address encoded in the pairing QR. Never localhost and never the `.local` name. */
export function wifiHost(cfg?: { lanBound?: boolean }): string | null {
  return phoneHosts(cfg).find((host) => isLanIPv4(host)) ?? null;
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
    const info: HealthInfo = { ok: true, version: "0.1.0", uptimeMs: Date.now() - startedAt, dataDir: cfg.dataDir, lanUrls: phoneHosts(cfg).map((host) => uiOrigin(cfg, host)) };
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

    const sub = db.getSubscription(dev.spaceId);
    const existingDevices = db.listDevices(dev.spaceId);
    if (existingDevices.length >= sub.limits.maxDevices) {
      return c.json({
        error: `Device limit reached on the Free plan (${sub.limits.maxDevices} devices). Upgrade to Pro for unlimited multi-device sync.`
      }, 403);
    }

    const wifi = wifiHost(cfg);
    if (!wifi) {
      const error = cfg.lanBound === false
        ? process.platform === "darwin"
          ? "macOS has not allowed Nimbus onto the local network yet. In System Settings, open Privacy & Security → Local Network, allow Nimbus, then reopen the app and generate a new code."
          : process.platform === "win32"
            ? "Windows has not allowed Nimbus through the firewall yet. Allow it, then reopen the app and generate a new code."
            : "This computer has not allowed Nimbus onto the local network yet. Allow local connections, then reopen the app and generate a new code."
        : "This computer has no Wi‑Fi address. Join the same network as the phone, then generate a new code.";
      return c.json({ error }, 409);
    }
    const { code, expiresAt } = db.createPairing(dev.spaceId);
    const hosts = phoneHosts(cfg);
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

    const sub = db.getSubscription(spaceId);
    if (db.listDevices(spaceId).length >= sub.limits.maxDevices) {
      return c.json({ error: `Device limit reached on the Free plan (${sub.limits.maxDevices} devices). Upgrade to Pro for unlimited multi-device sync.` }, 403);
    }

    const token = randomBytes(32).toString("hex");
    const device = db.createDevice(spaceId, (body.deviceName ?? "Mobile").slice(0, 60), body.platform ?? "mobile", token);
    registry.get(spaceId).space.deviceUpserted(device);
    return c.json({ token, deviceId: device.id, spaceId });
  });

  /** Subscription & Freemium management */
  app.get("/api/subscription", async (c) => {
    const dev = authed(c.req.header("authorization"));
    if (!dev) return c.json({ error: "unauthorized" }, 401);
    const space = registry.get(dev.spaceId).space;
    const subscription = space.getSubscription();
    return c.json({
      subscription,
      plans: [
        {
          id: "free",
          name: "Nimbus Free",
          price: 0,
          interval: "forever",
          description: "Bring your own models with full local-first privacy.",
          features: [
            "Bring your own models (Ollama, OpenAI, DeepSeek, xAI)",
            "Local SQLite database & zero-knowledge data storage",
            "Up to 2 connected devices (desktop + phone)",
            "Up to 2 custom subagents",
            "1 active connected app / MCP server",
            "Full tool execution & memory support"
          ],
        },
        {
          id: "pro_monthly",
          name: "Nimbus Pro",
          price: PLAN_PRICING_USD.pro_monthly ?? 0.01,
          interval: "month",
          description: "Uncapped multi-device power and autonomous agent capabilities.",
          popular: true,
          features: [
            "Everything in Free, plus:",
            "Unlimited connected devices & cross-network sync",
            "Unlimited custom subagents & skill orchestration",
            "Unlimited MCP servers & connected apps",
            "Autonomous background watch & notify monitors",
            "Encrypted cloud backup & relay sync",
            "Early access to new features & priority support"
          ],
        },
        {
          id: "pro_annual",
          name: "Nimbus Pro Annual",
          price: PLAN_PRICING_USD.pro_annual ?? 89,
          interval: "year",
          savings: "Save 20%",
          description: "Annual subscription for power users and developers.",
          features: [
            "All Pro features included",
            "Equivalent to $7.40 / month (save $19/yr)",
            "14-day money-back guarantee"
          ],
        },
        {
          id: "pro_lifetime",
          name: "Founder's Lifetime Pass",
          price: PLAN_PRICING_USD.pro_lifetime ?? 129,
          interval: "lifetime",
          description: "Pay once, unlock Pro forever across all your devices.",
          features: [
            "All Pro features with lifetime updates",
            "Zero recurring fees forever",
            "Founder Discord role & direct dev feedback channel"
          ],
        }
      ]
    });
  });

  app.post("/api/subscription/trial", async (c) => {
    const dev = authed(c.req.header("authorization"));
    if (!dev) return c.json({ error: "unauthorized" }, 401);
    try {
      const space = registry.get(dev.spaceId).space;
      const sub = space.startTrial();
      return c.json({ ok: true, subscription: sub });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.post("/api/subscription/activate", async (c) => {
    const dev = authed(c.req.header("authorization"));
    if (!dev) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { licenseKey?: string };
    const key = String(body.licenseKey ?? "").trim();
    if (!key) return c.json({ error: "License key is required" }, 400);
    try {
      const space = registry.get(dev.spaceId).space;
      const sub = space.activateLicense(key);
      return c.json({ ok: true, subscription: sub });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });

  app.get("/api/subscription/pricing", async (c) => {
    const rate = getUsdToKesRate();
    const plans = {
      monthly: convertPlanPrice("pro_monthly"),
      annual: convertPlanPrice("pro_annual"),
      lifetime: convertPlanPrice("pro_lifetime"),
    };
    return c.json({
      settlementCurrency: "KES",
      exchangeRate: rate,
      plans,
    });
  });

  app.post("/api/subscription/checkout", async (c) => {
    const dev = authed(c.req.header("authorization"));
    if (!dev) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { planId?: string; email?: string };
    const planId = body.planId ?? "pro_monthly";

    // Application-level conversion: Prices are presented in USD and converted to KES for processing
    const pricing = convertPlanPrice(planId);

    const account = db.accountBySpace(dev.spaceId);
    const email = body.email || account?.email || `user-${dev.spaceId.slice(-6)}@nimbus.app`;

    const origin = c.req.header("origin") || uiOrigin(cfg, "127.0.0.1");
    const callbackUrl = `${origin}/#/settings/subscription?payment=success`;

    try {
      const paystack = await initializePaystackTransaction({
        email,
        amountInCents: pricing.kesSubunits,
        currency: "KES",
        spaceId: dev.spaceId,
        planId,
        callbackUrl,
      });

      return c.json({
        ok: true,
        authorizationUrl: paystack.authorizationUrl,
        reference: paystack.reference,
        accessCode: paystack.accessCode,
        pricing,
      });
    } catch (e) {
      console.error("[nimbus] paystack checkout init failed:", e);
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  app.post("/api/subscription/verify", async (c) => {
    const dev = authed(c.req.header("authorization"));
    if (!dev) return c.json({ error: "unauthorized" }, 401);
    const body = (await c.req.json().catch(() => ({}))) as { reference?: string };
    const reference = String(body.reference ?? "").trim();
    if (!reference) return c.json({ error: "Reference is required" }, 400);

    try {
      const verified = await verifyPaystackTransaction(reference);
      if (!verified.success) {
        return c.json({ error: "Payment was not successful or could not be verified." }, 400);
      }

      const space = registry.get(dev.spaceId).space;
      const planId = verified.planId || "pro_monthly";
      const isLifetime = planId.includes("life");
      const isAnnual = planId.includes("annual") || planId.includes("year");

      const sub: SubscriptionInfo = {
        tier: "pro",
        status: "active",
        planName: isLifetime ? "Founder's Lifetime Pass" : isAnnual ? "Nimbus Pro (Annual)" : "Nimbus Pro",
        billingInterval: isLifetime ? "lifetime" : isAnnual ? "year" : "month",
        licenseKey: isLifetime ? `PSTK-LIFE-${reference.slice(-8).toUpperCase()}` : `PSTK-${reference.slice(-8).toUpperCase()}`,
        customerEmail: verified.customerEmail,
        isTrialEligible: false,
        limits: PRO_PLAN_LIMITS,
      };

      space.saveSubscription(sub);
      return c.json({ ok: true, subscription: sub });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  app.post("/api/subscription/webhook", async (c) => {
    const rawBody = await c.req.text().catch(() => "");
    const signature = c.req.header("x-paystack-signature");

    if (signature && !verifyPaystackWebhookSignature(rawBody, signature)) {
      return c.json({ error: "Invalid signature" }, 401);
    }

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const event = String(payload.event || payload.type || "");
    const data = payload.data || {};
    const spaceId = data.metadata?.spaceId || data.metadata?.space_id;

    if (spaceId && db.hasSpace(spaceId)) {
      const space = registry.get(spaceId).space;
      if (event === "charge.success") {
        const planId = String(data.metadata?.planId || "pro_monthly");
        const isLifetime = planId.includes("life");
        const isAnnual = planId.includes("annual") || planId.includes("year");

        space.saveSubscription({
          tier: "pro",
          status: "active",
          planName: isLifetime ? "Founder's Lifetime Pass" : isAnnual ? "Nimbus Pro (Annual)" : "Nimbus Pro",
          billingInterval: isLifetime ? "lifetime" : isAnnual ? "year" : "month",
          licenseKey: isLifetime ? `PSTK-LIFE-${String(data.reference || "").slice(-8).toUpperCase()}` : `PSTK-${String(data.reference || "").slice(-8).toUpperCase()}`,
          customerEmail: data.customer?.email,
          isTrialEligible: false,
          limits: PRO_PLAN_LIMITS,
        });
      } else if (event.includes("subscription.disable") || event.includes("failed")) {
        space.saveSubscription({
          tier: "free",
          status: "canceled",
          planName: "Nimbus Free",
          isTrialEligible: false,
          limits: FREE_PLAN_LIMITS,
        });
      }
    }

    return c.json({ received: true });
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
