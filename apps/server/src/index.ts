import { serve } from "@hono/node-server";
import { ensureDirs, loadConfig } from "./config.js";
import { Db } from "./db.js";
import { createHttpApp, phoneHosts, uiOrigin } from "./http.js";
import { Hub } from "./hub.js";
import { SpaceRegistry } from "./registry.js";

process.removeAllListeners("warning");
process.on("warning", (w) => { if (w.name !== "ExperimentalWarning") console.warn(w); });

const log = (level: string, msg: string, extra?: unknown) => {
  const line = `[nimbus] ${new Date().toISOString()} ${level.toUpperCase()} ${msg}${extra !== undefined ? ` ${typeof extra === "string" ? extra : JSON.stringify(extra)}` : ""}`;
  if (level === "error") console.error(line);
  else console.log(line);
};

async function main() {
  const cfg = loadConfig();
  await ensureDirs(cfg);
  const startedAt = Date.now();
  const db = new Db(cfg.dataDir);
  const registry = new SpaceRegistry(db, cfg, log);
  const hub = new Hub(db, registry, log);
  const app = createHttpApp(cfg, db, registry, startedAt);

  const server = serve(
    {
      fetch: (req, env: { incoming?: { socket?: { remoteAddress?: string } } }) => {
        return app.fetch(req, { remote: env?.incoming?.socket?.remoteAddress });
      },
      hostname: cfg.host,
      port: cfg.port,
    },
    (info) => {
      log("info", `listening on http://127.0.0.1:${info.port}`);
      for (const host of phoneHosts()) log("info", `phone: ${uiOrigin(cfg, host)}`);
      log("info", `data dir ${cfg.dataDir}`);
      log("info", `workspace ${cfg.defaultWorkspace}`);
      if (process.send) process.send({ type: "ready", port: info.port });
      console.log(`NIMBUS_READY ${info.port}`);
    },
  );

  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/ws")) hub.handleUpgrade(req, socket, head as Buffer);
    else socket.destroy();
  });

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
