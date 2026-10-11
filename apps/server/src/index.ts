import type { Server } from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import { ensureDirs, loadConfig, type ServerConfig } from "./config.js";
import { Db } from "./db.js";
import { createHttpApp, phoneHosts, uiOrigin } from "./http.js";
import { Hub } from "./hub.js";
import { SpaceRegistry } from "./registry.js";

for (const stream of [process.stdout, process.stderr]) stream.on("error", () => {});
process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "ExperimentalWarning") console.warn(w); });

const log = (level: string, msg: string, extra?: unknown) => {
  const line = `[nimbus] ${new Date().toISOString()} ${level.toUpperCase()} ${msg}${extra !== undefined ? ` ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`;
  if (level === "error") console.error(line);
  else console.log(line);
};

function localNetworkHint(): string {
  if (process.platform === "darwin") return "To link a phone, allow Nimbus in System Settings → Privacy & Security → Local Network, then reopen the app.";
  if (process.platform === "win32") return "To link a phone, allow Nimbus through the Windows firewall, then reopen the app.";
  return "To link a phone, allow Nimbus to accept local network connections, then reopen the app.";
}

function errno(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

/** The desktop shell watches both streams. A packaged Mac app may not have a console on stdout. */
function emitReady(port: number) {
  const line = `NIMBUS_READY ${port}\n`;
  try { process.stderr.write(line); } catch { /* the shell still has stdout */ }
  try { process.stdout.write(line); } catch { /* stderr already carried the marker */ }
}

function bind(fetch: (req: Request, env: { incoming?: { socket?: { remoteAddress?: string } } }) => Promise<Response> | Response, port: number, hostname: string): Promise<Server> {
  const server = createAdaptorServer({ fetch, hostname }) as Server;
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.close();
      reject(error);
    };
    server.once("error", onError);
    server.listen(port, hostname, () => {
      server.off("error", onError);
      resolve(server);
    });
  });
}

async function openPort(fetch: Parameters<typeof bind>[0], cfg: ServerConfig): Promise<Server> {
  try {
    return await bind(fetch, cfg.port, cfg.host);
  } catch (error) {
    const code = errno(error);
    if (code === "EADDRINUSE") throw new Error(`Port ${cfg.port} is already in use. Quit the other Nimbus window and open the app again.`);
    if (cfg.host === "127.0.0.1" || (code !== "EPERM" && code !== "EACCES" && code !== "EADDRNOTAVAIL")) throw error;
    log("error", `listening on ${cfg.host} was blocked (${code}). Nimbus will open on this computer only. ${localNetworkHint()}`);
    cfg.host = "127.0.0.1";
    cfg.lanBound = false;
    return bind(fetch, cfg.port, cfg.host);
  }
}

async function main() {
  const cfg = loadConfig();
  await ensureDirs(cfg);
  const startedAt = Date.now();
  const db = new Db(cfg.dataDir);
  const registry = new SpaceRegistry(db, cfg, log);
  const hub = new Hub(db, registry, log);
  const app = createHttpApp(cfg, db, registry, startedAt);
  const fetch = (req: Request, env: { incoming?: { socket?: { remoteAddress?: string } } }) => {
    return app.fetch(req, { remote: env?.incoming?.socket?.remoteAddress });
  };
  const server = await openPort(fetch, cfg);

  server.on("error", (error) => log("error", error instanceof Error ? error.message : "server error"));
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/ws")) hub.handleUpgrade(req, socket, head as Buffer);
    else socket.destroy();
  });

  let hosts: string[] = [];
  try { hosts = phoneHosts(cfg); } catch (error) {
    log("error", "could not list network addresses", error instanceof Error ? error.message : "unknown");
  }
  log("info", `listening on http://127.0.0.1:${cfg.port}`);
  for (const host of hosts) log("info", `phone: ${uiOrigin(cfg, host)}`);
  log("info", `data dir ${cfg.dataDir}`);
  log("info", `workspace ${cfg.defaultWorkspace}`);
  if (process.send) process.send({ type: "ready", port: cfg.port });
  emitReady(cfg.port);

  const shutdown = () => {
    log("info", "shutting down");
    server.close();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("message", (m) => { if (m === "shutdown") shutdown(); });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
