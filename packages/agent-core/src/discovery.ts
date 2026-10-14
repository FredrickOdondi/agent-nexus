import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { MemoryStore, SkillCatalog, SubagentCatalog } from "./types.js";
import type { SubagentInfo } from "@nimbus/shared";
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

function parseFrontmatter(md: string): {
  name?: string;
  description?: string;
  model?: string;
  avatar?: string;
  tools?: string[];
  body: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) return { body: md };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  let tools: string[] | undefined;
  if (meta.tools) {
    try {
      if (meta.tools.startsWith("[") && meta.tools.endsWith("]")) {
        tools = JSON.parse(meta.tools);
      } else {
        tools = meta.tools.split(",").map((s) => s.trim()).filter(Boolean);
      }
    } catch {
      tools = meta.tools.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return {
    name: meta.name,
    description: meta.description,
    model: meta.model,
    avatar: meta.avatar,
    tools,
    body: m[2],
  };
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

export const BUILTIN_SUBAGENTS: SubagentInfo[] = [
  {
    name: "explore",
    description: "Fast, read-only exploration of codebases and directories",
    scope: "builtin",
    avatar: "sky",
    tools: ["glob", "grep", "read_file", "list_dir", "web_search"],
    prompt: "You are an exploration subagent. Find relevant files, read definitions, inspect code structure, and report concise findings without modifying any files.",
  },
  {
    name: "review",
    description: "Thorough code and git diff reviewer checking for bugs, security, and edge cases",
    scope: "builtin",
    avatar: "cherry",
    tools: ["run_terminal_cmd", "read_file", "grep", "list_dir"],
    prompt: "You are a code review subagent. Analyze git diffs and code files for potential regressions, security vulnerabilities, edge cases, and performance traps.",
  },
  {
    name: "plan",
    description: "Architecture and implementation planner",
    scope: "builtin",
    avatar: "mint",
    tools: ["glob", "grep", "read_file", "list_dir"],
    prompt: "You are an implementation planning subagent. Explore the workspace and draft a clear, phased execution plan with risks and test strategy.",
  },
  {
    name: "general",
    description: "Autonomous subagent executing focused tasks end-to-end",
    scope: "builtin",
    avatar: "indigo",
    prompt: "You are an autonomous subagent executing a focused sub-task delegated by the primary agent. Complete your assignment and return a concise summary of the result.",
  },
];

/**
 * Subagents are markdown definitions under `.nimbus/subagents/<name>.md` or `.nimbus/subagents/<name>/SUBAGENT.md`.
 * Scoped by local > repo > user > builtin.
 */
export function createSubagentCatalog(cwd: string, extraDataDir?: string): SubagentCatalog {
  async function scan(): Promise<SubagentInfo[]> {
    const root = (await gitRoot(cwd)) ?? cwd;
    const home = os.homedir();
    const dataDir = extraDataDir ?? process.env.NIMBUS_DATA_DIR;
    const appSupport = path.join(home, "Library/Application Support/Nimbus/data");
    const parent = path.dirname(cwd);
    const grandparent = path.dirname(parent);
    const locations: { dir: string; scope: "local" | "repo" | "user" }[] = [
      { dir: path.join(cwd, ".nimbus/subagents"), scope: "local" },
      { dir: path.join(cwd, ".nimbus/agents"), scope: "local" },
      { dir: path.join(root, ".nimbus/subagents"), scope: "repo" },
      { dir: path.join(root, ".nimbus/agents"), scope: "repo" },
      { dir: path.join(parent, ".nimbus/subagents"), scope: "local" },
      { dir: path.join(grandparent, ".nimbus/subagents"), scope: "local" },
      { dir: path.join(process.cwd(), ".nimbus/subagents"), scope: "local" },
      { dir: path.join(process.cwd(), ".nimbus/agents"), scope: "local" },
      ...(dataDir ? [
        { dir: path.join(dataDir, ".nimbus/subagents"), scope: "user" as const },
        { dir: path.join(dataDir, "subagents"), scope: "user" as const },
      ] : []),
      { dir: path.join(appSupport, ".nimbus/subagents"), scope: "user" },
      { dir: path.join(appSupport, "subagents"), scope: "user" },
      { dir: path.join(home, ".nimbus/workspace/.nimbus/subagents"), scope: "local" },
      { dir: path.join(home, ".nimbus/subagents"), scope: "user" },
      { dir: path.join(home, ".nimbus/agents"), scope: "user" },
    ];
    const seen = new Map<string, SubagentInfo>();

    for (const loc of locations) {
      const entries = await fs.readdir(loc.dir, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        let filePath = "";
        let fallbackName = "";
        if (e.isFile() && e.name.endsWith(".md")) {
          filePath = path.join(loc.dir, e.name);
          fallbackName = e.name.replace(/\.md$/, "");
        } else if (e.isDirectory()) {
          const cand1 = path.join(loc.dir, e.name, "SUBAGENT.md");
          const cand2 = path.join(loc.dir, e.name, "AGENT.md");
          const cand3 = path.join(loc.dir, e.name, `${e.name}.md`);
          if (await exists(cand1)) filePath = cand1;
          else if (await exists(cand2)) filePath = cand2;
          else if (await exists(cand3)) filePath = cand3;
          fallbackName = e.name;
        }
        if (!filePath) continue;

        const text = await readText(filePath);
        if (!text) continue;
        const fm = parseFrontmatter(text);
        const name = (fm.name ?? fallbackName).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
        if (seen.has(name)) continue;

          seen.set(name, {
            name,
            description: fm.description ?? text.split("\n").find((l) => l.trim() && !l.startsWith("#"))?.trim() ?? "Custom subagent",
            path: filePath,
            scope: loc.scope,
            prompt: fm.body.trim(),
            tools: fm.tools,
            model: fm.model,
            avatar: fm.avatar || undefined,
          });
      }
    }

    // Merge built-ins if not overridden by custom files
    for (const builtin of BUILTIN_SUBAGENTS) {
      if (!seen.has(builtin.name)) {
        seen.set(builtin.name, builtin);
      }
    }

    return [...seen.values()];
  }

  return {
    list: scan,
    async load(name: string) {
      const all = await scan();
      const match = all.find((x) => x.name.toLowerCase() === name.toLowerCase());
      return match ?? null;
    },
  };
}

