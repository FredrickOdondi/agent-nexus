import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  /** Directory of the built web client to serve (optional in dev). */
  webDist: string | null;
  /** Port of the Vite dev server. Used for phone links while the UI is not served from here. */
  webDevPort: number;
  defaultWorkspace: string;
  platformName: string;
}

export function loadConfig(): ServerConfig {
  const argPort = process.argv.find((a) => a.startsWith("--port="))?.split("=")[1];
  const argData = process.argv.find((a) => a.startsWith("--data-dir="))?.split("=")[1];
  const argWeb = process.argv.find((a) => a.startsWith("--web-dist="))?.split("=")[1];
  const dataDir = path.resolve(argData ?? process.env.NIMBUS_DATA_DIR ?? path.join(os.homedir(), ".nimbus"));
  return {
    host: process.env.NIMBUS_HOST ?? "0.0.0.0",
    port: Number(argPort ?? process.env.NIMBUS_PORT ?? 47831),
    dataDir,
    webDist: argWeb ?? process.env.NIMBUS_WEB_DIST ?? null,
    webDevPort: Number(process.env.NIMBUS_WEB_PORT ?? 47830),
    defaultWorkspace: process.env.NIMBUS_WORKSPACE ?? path.join(dataDir, "workspace"),
    platformName: process.env.NIMBUS_PLATFORM_NAME ?? "Nimbus Desktop",
  };
}

export async function ensureDirs(cfg: ServerConfig) {
  await fs.mkdir(cfg.dataDir, { recursive: true });
  await fs.mkdir(cfg.defaultWorkspace, { recursive: true });
}
