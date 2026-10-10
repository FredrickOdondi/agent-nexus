import { promises as fs } from "node:fs";
import path from "node:path";
import ignore from "ignore";

export function resolveInside(root: string, p: string): string {
  const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(root, p);
  return abs;
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

export async function findUp(start: string, names: string[]): Promise<string | null> {
  let dir = path.resolve(start);
  for (;;) {
    for (const n of names) {
      const candidate = path.join(dir, n);
      if (await exists(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export async function gitRoot(start: string): Promise<string | null> {
  const dotGit = await findUp(start, [".git"]);
  return dotGit ? path.dirname(dotGit) : null;
}

const DEFAULT_IGNORES = ["node_modules", ".git", "dist", "build", ".next", "coverage", ".turbo", ".cache", "*.log", ".DS_Store"];

export async function loadIgnore(root: string) {
  const ig = ignore();
  ig.add(DEFAULT_IGNORES);
  const gi = await readText(path.join(root, ".gitignore"));
  if (gi) ig.add(gi);
  return {
    ignores(rel: string): boolean {
      if (!rel || rel === ".") return false;
      const normalized = rel.split(path.sep).join("/");
      try {
        return ig.ignores(normalized);
      } catch {
        return false;
      }
    },
  };
}

export function languageFromPath(p: string): string | undefined {
  const ext = path.extname(p).slice(1).toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
    json: "json", md: "markdown", py: "python", rs: "rust", go: "go", java: "java", kt: "kotlin",
    rb: "ruby", php: "php", sh: "bash", bash: "bash", zsh: "bash", yml: "yaml", yaml: "yaml", toml: "toml",
    css: "css", scss: "scss", html: "html", xml: "xml", sql: "sql", c: "c", h: "c", cpp: "cpp", hpp: "cpp",
    cs: "csharp", swift: "swift", dart: "dart", vue: "vue", svelte: "svelte",
  };
  return map[ext];
}

export function withLineNumbers(text: string, startLine = 1): string {
  const lines = text.split("\n");
  const width = String(startLine + lines.length - 1).length;
  return lines.map((l, i) => `${String(startLine + i).padStart(width, " ")}| ${l}`).join("\n");
}

export function clampText(text: string, max: number, note = "… [truncated]"): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n${note}`;
}
