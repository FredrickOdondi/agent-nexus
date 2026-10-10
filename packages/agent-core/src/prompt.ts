import os from "node:os";
import type { ToolDefinition } from "./types.js";

export interface PromptContext {
  cwd: string;
  workspaceRoot: string;
  profile: "main" | "explore" | "general" | "plan" | "review";
  mode: "agent" | "plan" | "chat";
  tools: ToolDefinition<any>[];
  rules: { path: string; content: string }[];
  skills: { name: string; description: string }[];
  memory: { global: string; workspace: string };
  addendum?: string;
  providerHostedTools: string[];
  platformName: string;
}

const PROFILE_PROMPTS: Record<PromptContext["profile"], string> = {
  main: "You are Nimbus, an autonomous software engineering and research agent running on the user's machine. You help with coding, debugging, research, writing and operating the local workspace.",
  explore: "You are an explore subagent. Research the codebase quickly and thoroughly using read-only tools. Return a precise, well-organised answer with file paths and line references. Do not modify anything.",
  general: "You are a general subagent with full tool access. Complete the delegated task end-to-end and report exactly what you changed and verified.",
  plan: "You are a planning subagent. Investigate with read-only tools and return a concrete, step-by-step implementation plan with files to change, risks and verification steps. Do not modify anything.",
  review: "You are a code review subagent. Inspect recent changes (use git diff / read files) and report bugs, risks, and concrete fixes ordered by severity. Do not modify anything.",
};

export function renderSystemPrompt(ctx: PromptContext): string {
  const lines: string[] = [];
  lines.push(PROFILE_PROMPTS[ctx.profile]);
  lines.push("");
  lines.push("# Environment");
  lines.push(`- Platform: ${ctx.platformName} (${os.platform()} ${os.arch()}), Node ${process.versions.node}`);
  lines.push(`- Working directory: ${ctx.cwd}`);
  if (ctx.workspaceRoot !== ctx.cwd) lines.push(`- Workspace root: ${ctx.workspaceRoot}`);
  lines.push(`- Date: ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");

  lines.push("# How to work");
  lines.push("- Think before acting. For multi-step work keep a todo list with todo_write and update it as you go.");
  lines.push("- Read before you edit. Use read_file / grep / glob / list_dir to understand code, then search_replace for targeted edits and write_file for new files.");
  lines.push("- Verify your work: run builds, tests or scripts with run_terminal_cmd and fix what breaks.");
  lines.push("- Prefer tools over guessing. If a fact is time-sensitive or outside your knowledge, search the web and cite sources with URLs.");
  lines.push("- Ask with ask_user_question only when a decision materially changes the work; otherwise make a sensible choice and state the assumption.");
  lines.push("- Use task to parallelise independent research or long work in subagents; give each a complete, self-contained prompt.");
  lines.push("- Never run interactive commands, never leak secrets, never perform destructive git operations (force push, reset --hard) without explicit instruction.");
  lines.push("- Write answers in concise Markdown. Use code blocks with language tags. Reference files as `path:line`.");
  if (ctx.mode === "plan") {
    lines.push("- You are in PLAN MODE: editing tools and shell commands are blocked. Research, then call exit_plan_mode with a complete plan for approval.");
  }
  if (ctx.mode === "chat") {
    lines.push("- You are in CHAT MODE: answer conversationally; use tools only when the user clearly asks for something requiring them.");
  }
  lines.push("");

  if (ctx.providerHostedTools.length) {
    lines.push("# Provider-hosted tools");
    lines.push(`The model provider executes these for you automatically: ${ctx.providerHostedTools.join(", ")}.`);
    lines.push("");
  }

  if (ctx.skills.length) {
    lines.push("# Skills");
    lines.push("Load a skill with the `skill` tool when a task matches its description:");
    for (const s of ctx.skills) lines.push(`- ${s.name}: ${s.description}`);
    lines.push("");
  }

  for (const r of ctx.rules) {
    lines.push(`# Project rules (${r.path})`);
    lines.push(r.content.trim());
    lines.push("");
  }

  if (ctx.memory.global.trim() || ctx.memory.workspace.trim()) {
    lines.push("# Memory");
    if (ctx.memory.global.trim()) lines.push(ctx.memory.global.trim().slice(0, 6000));
    if (ctx.memory.workspace.trim()) lines.push(ctx.memory.workspace.trim().slice(0, 6000));
    lines.push("Use the memory tool to append durable facts worth remembering across sessions.");
    lines.push("");
  }

  if (ctx.addendum?.trim()) {
    lines.push("# User instructions");
    lines.push(ctx.addendum.trim());
    lines.push("");
  }

  return lines.join("\n").trim();
}
