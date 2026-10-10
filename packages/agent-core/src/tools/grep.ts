import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { ToolDefinition } from "../types.js";
import { clampText, loadIgnore, resolveInside } from "../util/fs.js";

interface GrepArgs {
  pattern: string;
  path?: string;
  glob?: string;
  case_insensitive?: boolean;
  context?: number;
  max_results?: number;
}

let rgAvailable: boolean | null = null;
async function hasRipgrep(): Promise<boolean> {
  if (rgAvailable !== null) return rgAvailable;
  rgAvailable = await new Promise<boolean>((resolve) => {
    const p = spawn("rg", ["--version"]);
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
  return rgAvailable;
}

async function runRg(args: GrepArgs, cwd: string, signal: AbortSignal): Promise<string> {
  const rgArgs = ["--line-number", "--no-heading", "--color", "never", "--max-count", "200"];
  if (args.case_insensitive) rgArgs.push("-i");
  if (args.context) rgArgs.push("-C", String(Math.min(args.context, 5)));
  if (args.glob) rgArgs.push("--glob", args.glob);
  rgArgs.push("-e", args.pattern, ".");
  return new Promise((resolve) => {
    const p = spawn("rg", rgArgs, { cwd, signal });
    let out = "";
    p.stdout.on("data", (d) => { if (out.length < 200_000) out += d.toString(); });
    p.stderr.on("data", (d) => { out += d.toString(); });
    p.on("error", (e) => resolve(`rg error: ${e.message}`));
    p.on("close", () => resolve(out));
  });
}

async function runJs(args: GrepArgs, cwd: string, root: string): Promise<string> {
  let re: RegExp;
  try {
    re = new RegExp(args.pattern, args.case_insensitive ? "i" : "");
  } catch (e) {
    return `Invalid regex: ${(e as Error).message}`;
  }
  const ig = await loadIgnore(root);
  const files = await fg(args.glob ?? "**/*", { cwd, onlyFiles: true, dot: false, suppressErrors: true, ignore: ["**/node_modules/**", "**/.git/**"] });
  const lines: string[] = [];
  const max = args.max_results ?? 200;
  for (const rel of files) {
    if (ig.ignores(path.relative(root, path.join(cwd, rel)))) continue;
    const stat = await fs.stat(path.join(cwd, rel)).catch(() => null);
    if (!stat || stat.size > 2_000_000) continue;
    const buf = await fs.readFile(path.join(cwd, rel)).catch(() => null);
    if (!buf || buf.subarray(0, 1024).includes(0)) continue;
    const text = buf.toString("utf8").split("\n");
    for (let i = 0; i < text.length; i++) {
      if (re.test(text[i])) {
        lines.push(`${rel}:${i + 1}:${text[i]}`);
        if (lines.length >= max) return lines.join("\n");
      }
    }
  }
  return lines.join("\n");
}

export const grep: ToolDefinition<GrepArgs> = {
  id: "grep",
  title: "grep",
  category: "search",
  description: "Search file contents with a regular expression. Uses ripgrep when installed. Output is `path:line:text`. Limit results with glob (e.g. '*.ts') and max_results.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern (ripgrep/JS syntax)." },
      path: { type: "string", description: "Directory or file to search. Defaults to the workspace." },
      glob: { type: "string", description: "Only search files matching this glob, e.g. '**/*.tsx'." },
      case_insensitive: { type: "boolean" },
      context: { type: "number", description: "Lines of context around matches (ripgrep only)." },
      max_results: { type: "number" },
    },
    required: ["pattern"],
  },
  permission: "Grep",
  readOnly: true,
  summarize: (a) => a.pattern,
  permissionSubject: (a) => a.path ?? ".",
  async execute(args, ctx) {
    const cwd = resolveInside(ctx.cwd, args.path ?? ".");
    const out = (await hasRipgrep()) ? await runRg(args, cwd, ctx.signal) : await runJs(args, cwd, ctx.workspaceRoot);
    const trimmed = out.trim();
    return { output: trimmed ? clampText(trimmed, 30_000) : "No matches." };
  },
};
