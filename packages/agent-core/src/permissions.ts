import type { PermissionClass, PermissionConfig, PermissionDecision, ToolDefinition } from "./types.js";

/**
 * Permission rules use Grok Build's `ToolPrefix(glob)` syntax:
 *   Bash(git *)      Edit(src/**)     WebFetch(domain:docs.rs)     MCPTool(*)
 * Deny rules win over allow rules. Mode `auto` approves everything not denied,
 * `ask` prompts for anything that mutates, `read_only`/`plan` block mutations.
 */

interface ParsedRule {
  prefix: PermissionClass;
  pattern: string;
}

const PREFIXES: PermissionClass[] = ["Bash", "Edit", "Write", "Read", "Grep", "WebFetch", "MCPTool", "Task", "Computer"];

export function parseRule(rule: string): ParsedRule | null {
  const m = /^(\w+)\((.*)\)$/.exec(rule.trim());
  if (!m) return null;
  const prefix = m[1] as PermissionClass;
  if (!PREFIXES.includes(prefix)) return null;
  return { prefix, pattern: m[2].trim() || "*" };
}

export function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else out += "[^/]*";
    } else if (c === "?") out += ".";
    else if ("\\^$+.()|{}[]".includes(c)) out += `\\${c}`;
    else out += c;
  }
  return new RegExp(`${out}$`, "s");
}

function matches(rule: ParsedRule, prefix: PermissionClass, subject: string): boolean {
  if (rule.prefix !== prefix) return false;
  if (rule.pattern === "*" || rule.pattern === "**") return true;
  if (prefix === "WebFetch" && rule.pattern.startsWith("domain:")) {
    try {
      const host = new URL(subject).hostname;
      const want = rule.pattern.slice("domain:".length);
      return host === want || host.endsWith(`.${want}`);
    } catch {
      return false;
    }
  }
  return globToRegExp(rule.pattern).test(subject);
}

export function evaluatePermission(
  tool: ToolDefinition<any>,
  args: Record<string, unknown>,
  config: PermissionConfig,
): PermissionDecision {
  if (!tool.permission) return "allow";
  const subject = tool.permissionSubject ? tool.permissionSubject(args) : "";
  const prefix = tool.permission;

  for (const raw of config.deny) {
    const r = parseRule(raw);
    if (r && matches(r, prefix, subject)) return "deny";
  }
  if (tool.readOnly) return "allow";

  if (config.mode === "read_only" || config.mode === "plan") return "deny";
  if (config.sessionAllow.has(tool.id)) return "allow";
  for (const raw of config.allow) {
    const r = parseRule(raw);
    if (r && matches(r, prefix, subject)) return "allow";
  }
  if (config.mode === "auto") return "allow";
  return "ask";
}
