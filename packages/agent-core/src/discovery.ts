import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MemoryStore, SkillCatalog } from "./types.js";
import { exists, gitRoot, readText } from "./util/fs.js";

/** AGENTS.md / CLAUDE.md style project rules appended to the system prompt. */
const RULE_FILES = ["AGENTS.md", "AGENT.md", "Agents.md", "CLAUDE.md", "Claude.md", ".nimbus/RULES.md"];

export async function loadProjectRules(cwd: string): Promise<{ path: string; content: string }[]> {
  const found: { path: string; content: string }[] = [];
  const root = (await gitRoot(cwd)) ?? cwd;
  const dirs = new Set<string>([cwd]);
  let d = cwd;
  while (d.startsWith(root) && d !== path.dirname(d)) {
    dirs.add(d);
    d = path.dirname(d);
  }
  dirs.add(root);
  for (const dir of [...dirs].reverse()) {
    for (const name of RULE_FILES) {
      const p = path.join(dir, name);
      const text = await readText(p);
      if (text && text.trim()) {
        found.push({ path: p, content: text.slice(0, 20_000) });
        break;
      }
    }
  }
  return found;
}

function parseFrontmatter(md: string): { name?: string; description?: string; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(md);
  if (!m) return { body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { name: meta.name, description: meta.description, body: m[2] };
}

/**
 * Skills are `<dir>/<name>/SKILL.md` packages. Priority mirrors Grok Build:
 * ./.nimbus/skills (local) > <repo>/.nimbus/skills (repo) > ~/.nimbus/skills (user).
 * `.grok/skills` and `~/.claude/skills` are read for compatibility.
 */
export function createSkillCatalog(cwd: string): SkillCatalog {
  async function scan() {
    const root = (await gitRoot(cwd)) ?? cwd;
    const home = os.homedir();
    const locations: { dir: string; scope: "local" | "repo" | "user" }[] = [
      { dir: path.join(cwd, ".nimbus/skills"), scope: "local" },
      { dir: path.join(cwd, ".grok/skills"), scope: "local" },
      { dir: path.join(root, ".nimbus/skills"), scope: "repo" },
      { dir: path.join(root, ".grok/skills"), scope: "repo" },
      { dir: path.join(home, ".nimbus/skills"), scope: "user" },
      { dir: path.join(home, ".grok/skills"), scope: "user" },
      { dir: path.join(home, ".claude/skills"), scope: "user" },
    ];
    const seen = new Map<string, { name: string; description: string; path: string; scope: "local" | "repo" | "user" }>();
    for (const loc of locations) {
      const entries = await fs.readdir(loc.dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const p = path.join(loc.dir, e.name, "SKILL.md");
        const text = await readText(p);
        if (!text) continue;
        const fm = parseFrontmatter(text);
        const name = fm.name ?? e.name;
        if (seen.has(name)) continue;
        seen.set(name, { name, description: fm.description ?? text.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "", path: p, scope: loc.scope });
      }
    }
    return [...seen.values()];
  }
  return {
    list: scan,
    async load(name) {
      const all = await scan();
      const s = all.find((x) => x.name === name);
      if (!s) return null;
      const text = await readText(s.path);
      return text ? parseFrontmatter(text).body.trim() : null;
    },
  };
}

/** MEMORY.md store under <dataDir>/memory, workspace-scoped by a path slug. */
export function createMemoryStore(dataDir: string, workspaceRoot: string): MemoryStore {
  const slug = workspaceRoot.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(-80) || "default";
  const files = {
    global: path.join(dataDir, "memory", "MEMORY.md"),
    workspace: path.join(dataDir, "memory", slug, "MEMORY.md"),
  };
  return {
    async read(scope) {
      return (await readText(files[scope])) ?? "";
    },
    async append(scope, text) {
      const file = files[scope];
      await fs.mkdir(path.dirname(file), { recursive: true });
      const existing = (await exists(file)) ? await fs.readFile(file, "utf8") : scope === "global" ? "# Global memory\n" : `# Workspace memory\n\nWorkspace: ${workspaceRoot}\n`;
      const stamp = new Date().toISOString().slice(0, 10);
      await fs.writeFile(file, `${existing.trimEnd()}\n\n- (${stamp}) ${text.replace(/\n/g, "\n  ")}\n`, "utf8");
    },
  };
}
