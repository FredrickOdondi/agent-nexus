import type { ToolInfo } from "@nimbus/shared";
import type { ToolDefinition } from "./types.js";
import { appsTool } from "./tools/apps.js";
import { applescriptTool } from "./tools/applescript.js";
import { browserTool } from "./tools/browser.js";
import { clipboardTool } from "./tools/clipboard.js";
import { computerTool } from "./tools/computer.js";
import { docParseTool } from "./tools/doc-parse.js";
import { globTool, listDir, readFile, searchReplace, writeFile } from "./tools/files.js";
import { grep } from "./tools/grep.js";
import { imageGen } from "./tools/image.js";
import { notifyTool } from "./tools/notify.js";
import { scheduleTool } from "./tools/schedule.js";
import { getTaskOutput, taskTool } from "./tools/task.js";
import { runTerminalCmd } from "./tools/terminal.js";
import { fileWatchTool } from "./tools/watch.js";
import { webFetch, webSearch } from "./tools/web.js";
import { askUserQuestion, enterPlanMode, exitPlanMode, memoryTool, skillTool, todoWrite } from "./tools/workflow.js";
import { renderUiTool } from "./tools/ui.js";
import { subagentManageTool } from "./tools/subagent.js";

export const BUILTIN_TOOLS: ToolDefinition<any>[] = [
  runTerminalCmd,
  readFile,
  writeFile,
  searchReplace,
  listDir,
  globTool,
  grep,
  webSearch,
  webFetch,
  todoWrite,
  taskTool,
  getTaskOutput,
  askUserQuestion,
  memoryTool,
  enterPlanMode,
  exitPlanMode,
  skillTool,
  imageGen,
  computerTool,
  appsTool,
  clipboardTool,
  applescriptTool,
  notifyTool,
  browserTool,
  scheduleTool,
  fileWatchTool,
  docParseTool,
  subagentManageTool,
  renderUiTool,
];

export interface RegistryOptions {
  /** Explicit allowlist of tool ids (Grok Build `--tools`). */
  allow?: string[];
  /** Denylist of tool ids (Grok Build `--disallowed-tools`). */
  disallow?: string[];
  subagentsEnabled: boolean;
  webSearchEnabled: boolean;
  memoryEnabled: boolean;
  /** Provider executes web search itself → drop the local implementation. */
  providerHostsWebSearch: boolean;
  /** Subagent profiles get a trimmed surface. */
  profile?: string;
}

/**
 * Composes the finalized tool set for a session. Like Grok Build's builder,
 * capabilities without a backing resource are removed rather than advertised.
 */
export class ToolRegistry {
  private dynamic: ToolDefinition<any>[] = [];

  registerDynamic(tool: ToolDefinition<any>) {
    this.dynamic = this.dynamic.filter((t) => t.id !== tool.id);
    this.dynamic.push(tool);
  }

  finalize(opts: RegistryOptions): ToolDefinition<any>[] {
    let tools = [...BUILTIN_TOOLS, ...this.dynamic];
    const drop = new Set<string>(opts.disallow ?? []);

    if (!opts.subagentsEnabled || opts.profile === "explore" || opts.profile === "review") {
      drop.add("task");
    }
    if (!opts.webSearchEnabled || opts.providerHostsWebSearch) drop.add("web_search");
    if (!opts.memoryEnabled) drop.add("memory");
    if (opts.profile === "explore" || opts.profile === "review" || opts.profile === "plan") {
      drop.add("write_file");
      drop.add("search_replace");
      drop.add("ask_user_question");
      drop.add("enter_plan_mode");
      drop.add("exit_plan_mode");
      drop.add("image_gen");
      drop.add("todo_write");
    }
    if (opts.profile && opts.profile !== "main") {
      drop.add("memory");
      drop.add("computer");
      drop.add("apps");
      drop.add("clipboard");
      drop.add("applescript");
      drop.add("browser");
      drop.add("notify");
      drop.add("subagent_manage");
    }

    tools = tools.filter((t) => !drop.has(t.id));
    if (opts.allow && opts.allow.length > 0) {
      const allow = new Set(opts.allow);
      tools = tools.filter((t) => allow.has(t.id));
    }
    return tools;
  }

  describe(tools: ToolDefinition<any>[]): ToolInfo[] {
    return tools.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
      description: t.description,
      source: t.source ?? (t.id.startsWith("mcp__") ? "mcp" : t.id.startsWith("COMPOSIO_") ? "composio" : "builtin"),
      enabled: true,
    }));
  }
}
