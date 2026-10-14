import { promises as fs } from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { ToolDefinition } from "../types.js";
import { clampText, languageFromPath, loadIgnore, resolveInside, withLineNumbers } from "../util/fs.js";

const MAX_READ = 60_000;

export const readFile: ToolDefinition<{ path: string; start_line?: number; end_line?: number }> = {
  id: "read_file",
  title: "read_file",
  category: "file",
  description: "Read a file from the workspace with line numbers. Prefer reading whole files; use start_line/end_line for very large files. Reads binary files as a size summary.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or workspace-relative path." },
      start_line: { type: "number", description: "1-based first line to include." },
      end_line: { type: "number", description: "1-based last line to include (inclusive)." },
    },
    required: ["path"],
  },
  permission: "Read",
  readOnly: true,
  summarize: (a) => a.path,
  permissionSubject: (a) => a.path,
  async execute(args, ctx) {
    const abs = resolveInside(ctx.cwd, args.path);
    const stat = await fs.stat(abs).catch(() => null);
    if (!stat) return { output: `File not found: ${args.path}`, isError: true };
    if (stat.isDirectory()) return { output: `${args.path} is a directory. Use list_dir.`, isError: true };
    const buf = await fs.readFile(abs);
    if (buf.subarray(0, 1024).includes(0)) return { output: `Binary file (${stat.size} bytes): ${args.path}` };
    const text = buf.toString("utf8");
    const lines = text.split("\n");
    const start = Math.max(1, args.start_line ?? 1);
    const end = Math.min(lines.length, args.end_line ?? lines.length);
    const slice = lines.slice(start - 1, end).join("\n");
    const numbered = withLineNumbers(slice, start);
    return {
      output: clampText(numbered, MAX_READ, `… [truncated; file has ${lines.length} lines — request a range]`),
      display: { kind: "file", path: args.path, content: clampText(slice, 20_000), language: languageFromPath(abs) },
    };
  },
};

export const writeFile: ToolDefinition<{ path: string; content: string }> = {
  id: "write_file",
  title: "write_file",
  category: "file",
  description: "Create or fully overwrite a file. Creates parent directories. Prefer search_replace for edits to existing files.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or workspace-relative path." },
      content: { type: "string", description: "Full file contents." },
    },
    required: ["path", "content"],
  },
  permission: "Write",
  readOnly: false,
  summarize: (a) => `write ${a.path}`,
  permissionSubject: (a) => a.path,
  async execute(args, ctx) {
    const abs = resolveInside(ctx.cwd, args.path);
    const norm = abs.replace(/\\/g, "/");
    if ((norm.includes("/.nimbus/subagents/") || norm.includes("/.nimbus/agents/")) && norm.endsWith(".md")) {
      const isPro = ctx.session.subscription?.tier === "pro";
      if (!isPro) {
        const stat = await fs.stat(abs).catch(() => null);
        if (!stat) {
          const all = await ctx.session.subagents.list().catch(() => []);
          const custom = all.filter((s) => s.scope !== "builtin");
          const max = ctx.session.limits?.maxSubagents ?? 2;
          if (custom.length >= max) {
            return {
              output: `SUBSCRIPTION LIMIT REACHED: The user is on the Free plan, which is limited to ${max} custom subagents. You already have ${custom.length} custom subagents (${custom.map((s) => '/' + s.name).join(", ")}). Direct creation of additional subagents is blocked. Inform the user to upgrade in Settings → Plan & Billing or start their 14-day free trial.`,
              isError: true,
            };
          }
        }
      }
    }
    const before = await fs.readFile(abs, "utf8").catch(() => "");
    await ctx.session.checkpoints.snapshot(abs);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, args.content, "utf8");
    return {
      output: `Wrote ${args.content.length} chars to ${args.path}.`,
      display: { kind: "diff", path: args.path, before, after: args.content },
    };
  },
};

interface SearchReplaceArgs {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/** Normalises whitespace so near-matches (indentation drift) still apply. */
function fuzzyFind(haystack: string, needle: string): { index: number; length: number } | null {
  const norm = (s: string) => s.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  const target = norm(needle);
  if (!target) return null;
  const lines = haystack.split("\n");
  const needleLines = target.split("\n").length;
  for (let i = 0; i + needleLines <= lines.length; i++) {
    const window = lines.slice(i, i + needleLines).join("\n");
    if (norm(window) === target) {
      const index = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0);
      return { index, length: window.length };
    }
  }
  return null;
}

export const searchReplace: ToolDefinition<SearchReplaceArgs> = {
  id: "search_replace",
  title: "search_replace",
  category: "file",
  description:
    "Edit a file by replacing `old_string` with `new_string`. `old_string` must match exactly once (include enough surrounding lines to be unique) unless replace_all is true. Falls back to whitespace-insensitive matching when an exact match is not found.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string" },
      old_string: { type: "string", description: "Text to find. Use an empty string to append to the file." },
      new_string: { type: "string", description: "Replacement text." },
      replace_all: { type: "boolean" },
    },
    required: ["path", "old_string", "new_string"],
  },
  permission: "Edit",
  readOnly: false,
  summarize: (a) => `edit ${a.path}`,
  permissionSubject: (a) => a.path,
  async execute(args, ctx) {
    const abs = resolveInside(ctx.cwd, args.path);
    const before = await fs.readFile(abs, "utf8").catch(() => null);
    if (before === null) return { output: `File not found: ${args.path}`, isError: true };
    let after: string;
    if (args.old_string === "") {
      after = before + (before.endsWith("\n") || before === "" ? "" : "\n") + args.new_string;
    } else if (args.replace_all) {
      const count = before.split(args.old_string).length - 1;
      if (count === 0) return { output: `old_string not found in ${args.path}.`, isError: true };
      after = before.split(args.old_string).join(args.new_string);
    } else {
      const count = before.split(args.old_string).length - 1;
      if (count > 1) return { output: `old_string matches ${count} times in ${args.path}; include more context to make it unique or set replace_all.`, isError: true };
      if (count === 1) {
        after = before.replace(args.old_string, () => args.new_string);
      } else {
        const fuzzy = fuzzyFind(before, args.old_string);
        if (!fuzzy) return { output: `old_string not found in ${args.path}. Re-read the file and retry with exact text.`, isError: true };
        after = before.slice(0, fuzzy.index) + args.new_string + before.slice(fuzzy.index + fuzzy.length);
      }
    }
    await ctx.session.checkpoints.snapshot(abs);
    await fs.writeFile(abs, after, "utf8");
    const delta = after.split("\n").length - before.split("\n").length;
    return {
      output: `Edited ${args.path} (${delta >= 0 ? "+" : ""}${delta} lines).`,
      display: { kind: "diff", path: args.path, before, after },
    };
  },
};

export const listDir: ToolDefinition<{ path?: string; depth?: number }> = {
  id: "list_dir",
  title: "list_dir",
  category: "file",
  description: "List files and folders (respects .gitignore). Directories end with '/'.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory to list. Defaults to the workspace root." },
      depth: { type: "number", description: "Recursion depth (1 = direct children). Default 1, max 4." },
    },
  },
  permission: "Read",
  readOnly: true,
  summarize: (a) => a.path ?? ".",
  permissionSubject: (a) => a.path ?? ".",
  async execute(args, ctx) {
    const abs = resolveInside(ctx.cwd, args.path ?? ".");
    const ig = await loadIgnore(ctx.workspaceRoot);
    const depth = Math.min(Math.max(args.depth ?? 1, 1), 4);
    const entries: string[] = [];
    async function walk(dir: string, level: number) {
      const list = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      list.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
      for (const e of list) {
        const full = path.join(dir, e.name);
        const rel = path.relative(ctx.workspaceRoot, full) || e.name;
        if (ig.ignores(e.isDirectory() ? `${rel}/` : rel)) continue;
        const shown = path.relative(abs, full) || e.name;
        entries.push(e.isDirectory() ? `${shown}/` : shown);
        if (e.isDirectory() && level < depth) await walk(full, level + 1);
        if (entries.length > 2000) return;
      }
    }
    await walk(abs, 1);
    if (entries.length === 0) {
      const stat = await fs.stat(abs).catch(() => null);
      if (!stat) return { output: `Directory not found: ${args.path ?? "."}`, isError: true };
    }
    return { output: entries.join("\n") || "(empty)", display: { kind: "list", path: args.path ?? ".", entries } };
  },
};

export const globTool: ToolDefinition<{ pattern: string; path?: string }> = {
  id: "glob",
  title: "glob",
  category: "search",
  description: "Find files matching a glob pattern (e.g. 'src/**/*.tsx'). Returns up to 500 paths sorted by modification time.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string", description: "Directory to search in. Defaults to the workspace root." },
    },
    required: ["pattern"],
  },
  permission: "Grep",
  readOnly: true,
  summarize: (a) => a.pattern,
  permissionSubject: (a) => a.pattern,
  async execute(args, ctx) {
    const cwd = resolveInside(ctx.cwd, args.path ?? ".");
    const files = await fg(args.pattern, { cwd, dot: false, ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**"], onlyFiles: true, stats: true, suppressErrors: true });
    files.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
    const out = files.slice(0, 500).map((f) => f.path);
    return { output: out.join("\n") || "No files matched.", display: { kind: "list", path: args.pattern, entries: out } };
  },
};
