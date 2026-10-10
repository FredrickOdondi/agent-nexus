import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { HookDefinition, HookResult } from "./types.js";
import { globToRegExp } from "./permissions.js";

/**
 * Hooks are project lifecycle scripts discovered from `.nimbus/hooks/*.json`
 * (and `.grok/hooks/*.json` for compatibility). Shape mirrors Grok Build:
 *
 *   { "hooks": { "PreToolUse": [ { "matcher": "run_terminal_cmd", "hooks": [ { "command": "./guard.sh" } ] } ] } }
 *
 * Scripts receive JSON on stdin and may print JSON with `permission` / `additionalContext`.
 * Hooks fail open: errors never block the agent.
 */
export async function discoverHooks(workspaceRoot: string): Promise<HookDefinition[]> {
  const out: HookDefinition[] = [];
  for (const dir of [".nimbus/hooks", ".grok/hooks"]) {
    const full = path.join(workspaceRoot, dir);
    const files = await fs.readdir(full).catch(() => []);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const json = JSON.parse(await fs.readFile(path.join(full, f), "utf8")) as {
          hooks?: Record<string, { matcher?: string; hooks: { command: string; timeout?: number }[] }[]>;
        };
        for (const [event, blocks] of Object.entries(json.hooks ?? {})) {
          for (const block of blocks) {
            for (const h of block.hooks) {
              out.push({ event: event as HookDefinition["event"], matcher: block.matcher, command: h.command, timeoutMs: (h.timeout ?? 10) * 1000 });
            }
          }
        }
      } catch {
        /* malformed hook file: skip */
      }
    }
  }
  return out;
}

export async function runHooks(
  hooks: HookDefinition[],
  event: HookDefinition["event"],
  payload: Record<string, unknown>,
  cwd: string,
): Promise<HookResult> {
  const merged: HookResult = {};
  for (const h of hooks) {
    if (h.event !== event) continue;
    if (h.matcher && typeof payload.tool_name === "string" && !globToRegExp(h.matcher).test(payload.tool_name)) continue;
    const res = await runOne(h, payload, cwd).catch(() => ({}) as HookResult);
    if (res.permission === "deny") return { permission: "deny", reason: res.reason };
    if (res.permission === "ask" && merged.permission !== "deny") merged.permission = "ask";
    if (res.additionalContext) merged.additionalContext = `${merged.additionalContext ?? ""}\n${res.additionalContext}`.trim();
  }
  return merged;
}

function runOne(hook: HookDefinition, payload: Record<string, unknown>, cwd: string): Promise<HookResult> {
  return new Promise((resolve) => {
    const child = spawn(hook.command, { cwd, shell: true, stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => { child.kill(); resolve({}); }, hook.timeoutMs ?? 10_000);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.on("error", () => { clearTimeout(timer); resolve({}); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(out.trim() ? (JSON.parse(out) as HookResult) : {});
      } catch {
        resolve({});
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
