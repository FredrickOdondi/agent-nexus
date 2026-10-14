/** Process helpers shared by the screen modules. */
import { spawn } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";

export class ScreenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenError";
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function run(bin: string, args: string[], timeoutMs = 20_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new ScreenError(`${bin} timed out.`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new ScreenError(`${bin} failed to start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new ScreenError((stderr || stdout || `${bin} exited ${code ?? "unknown"}`).trim().slice(0, 600)));
    });
  });
}

export async function commandExists(name: string): Promise<boolean> {
  const entries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  for (const dir of entries) {
    for (const suffix of suffixes) {
      try {
        await fs.access(path.join(dir, name + suffix), constants.X_OK);
        return true;
      } catch { /* keep looking */ }
    }
  }
  return false;
}

export async function firstAvailable(names: string[]): Promise<string | null> {
  for (const name of names) if (await commandExists(name)) return name;
  return null;
}
