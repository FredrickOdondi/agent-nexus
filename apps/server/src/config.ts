import { readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Load KEY=VALUE lines. Existing environment variables win. */
function loadEnvFile(file: string) {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] = value;
  }
}

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
  /** False when the OS refused a non-loopback socket. Phone links stay off until it is allowed. */
  lanBound: boolean;
}

export function loadConfig(): ServerConfig {
  const here = path.dirname(fileURLToPath(import.meta.url));
  loadEnvFile(path.resolve(process.cwd(), ".env"));
  loadEnvFile(path.resolve(here, "../../../.env"));
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
    lanBound: true,
  };
}

export async function ensureDirs(cfg: ServerConfig) {
  await fs.mkdir(cfg.dataDir, { recursive: true });
  await fs.mkdir(cfg.defaultWorkspace, { recursive: true });
}
