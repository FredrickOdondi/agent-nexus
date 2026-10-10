import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { ensureDirs, loadConfig } from "./config.js";
import { Db } from "./db.js";
import { createHttpApp, lanAddresses } from "./http.js";
import { Hub } from "./hub.js";
import { RunManager } from "./runs.js";
import { SpaceService } from "./space.js";

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
  const { spaceId } = db.ensurePrimarySpace(cfg.defaultWorkspace);
  const tokenPath = path.join(cfg.dataDir, "primary-device.token");
  const { token: primaryToken } = db.getOrCreatePrimaryDevice(spaceId, cfg.platformName, "desktop", {
    read: () => { try { return readFileSync(tokenPath, "utf8").trim() || null; } catch { return null; } },
    write: (t) => writeFileSync(tokenPath, t, { mode: 0o600 }),
  });

  const space = new SpaceService(db, spaceId, cfg.defaultWorkspace);
  const runs = new RunManager(space, cfg.dataDir, cfg.platformName, log);
  const hub = new Hub(db, space, runs, log);
  const app = createHttpApp(cfg, db, space, primaryToken, startedAt);

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
      for (const ip of lanAddresses()) log("info", `LAN: http://${ip}:${info.port}`);
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
