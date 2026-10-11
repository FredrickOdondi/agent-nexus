import type { ToolInfo } from "./types.js";

/**
 * The built-in tool surface, mirroring Grok Build's tool IDs
 * (run_terminal_cmd, read_file, grep, search_replace, list_dir, web_search,
 * web_fetch, todo_write, task, get_task_output, ask_user_question …) plus the
 * provider-hosted xAI Agent Tools (web_search, x_search, code_execution).
 */
export const BUILTIN_TOOL_CATALOG: Omit<ToolInfo, "enabled">[] = [
  { id: "run_terminal_cmd", title: "bash", category: "shell", source: "builtin", description: "Run a shell command in the workspace with streamed output, timeouts and background mode." },
  { id: "read_file", title: "read_file", category: "file", source: "builtin", description: "Read a file (optionally a line range) with line numbers." },
  { id: "write_file", title: "write_file", category: "file", source: "builtin", description: "Create or overwrite a file." },
  { id: "search_replace", title: "search_replace", category: "file", source: "builtin", description: "Edit a file by replacing a unique block of text (exact or fuzzy match)." },
  { id: "list_dir", title: "list_dir", category: "file", source: "builtin", description: "List directory entries respecting .gitignore." },
  { id: "glob", title: "glob", category: "search", source: "builtin", description: "Find files by glob pattern." },
  { id: "grep", title: "grep", category: "search", source: "builtin", description: "Regex search across files (ripgrep when available)." },
  { id: "web_search", title: "web_search", category: "external", source: "builtin", description: "Search the web and return titles, URLs and snippets." },
  { id: "web_fetch", title: "web_fetch", category: "external", source: "builtin", description: "Fetch a URL and convert it to Markdown (SSRF-guarded, size-capped)." },
  { id: "todo_write", title: "todo_write", category: "workflow", source: "builtin", description: "Maintain the session task list shown in the UI." },
  { id: "task", title: "task", category: "workflow", source: "builtin", description: "Spawn a subagent (explore, general, plan, review) with its own context window." },
  { id: "get_task_output", title: "get_task_output", category: "workflow", source: "builtin", description: "Poll or wait for background tasks and subagents." },
  { id: "ask_user_question", title: "ask_user_question", category: "workflow", source: "builtin", description: "Ask the user a structured multiple-choice question and wait for the answer." },
  { id: "memory", title: "memory", category: "workflow", source: "builtin", description: "Read or append to global/workspace MEMORY.md for cross-session knowledge." },
  { id: "enter_plan_mode", title: "enter_plan_mode", category: "workflow", source: "builtin", description: "Switch to plan mode: edits and commands are blocked until the plan is approved." },
  { id: "exit_plan_mode", title: "exit_plan_mode", category: "workflow", source: "builtin", description: "Submit the plan for approval and leave plan mode." },
  { id: "skill", title: "skill", category: "workflow", source: "builtin", description: "Load a SKILL.md into context by name." },
  { id: "image_gen", title: "image_gen", category: "external", source: "builtin", description: "Generate an image with the configured provider (xAI grok-imagine)." },
  { id: "computer", title: "screen", category: "external", source: "builtin", description: "See the computer's screen and click, type, or scroll. Clicks happen on the machine running Nimbus." },
  { id: "x_search", title: "x_search", category: "external", source: "provider", description: "Search X posts, users and threads (xAI server-side tool)." },
  { id: "code_execution", title: "code_execution", category: "external", source: "provider", description: "Run Python in xAI's sandbox (xAI server-side tool)." },
];

export const SUBAGENT_TYPES = ["explore", "general", "plan", "review"] as const;
export type SubagentType = (typeof SUBAGENT_TYPES)[number];
