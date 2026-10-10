import { SUBAGENT_TYPES } from "@nimbus/shared";
import type { ToolDefinition } from "../types.js";
import { clampText } from "../util/fs.js";

interface TaskArgs {
  description: string;
  prompt: string;
  subagent_type: string;
  run_in_background?: boolean;
}

export const taskTool: ToolDefinition<TaskArgs> = {
  id: "task",
  title: "task",
  category: "workflow",
  description:
    `Delegate work to a subagent with its own context window. Types: ${SUBAGENT_TYPES.join(", ")}. ` +
    "explore = fast read-only codebase research; general = full tool access; plan = produce an implementation plan; review = code review of recent changes. " +
    "Give a complete, self-contained prompt — the child cannot see this conversation. Use run_in_background=true to spawn several in parallel, then collect with get_task_output.",
  parameters: {
    type: "object",
    properties: {
      description: { type: "string", description: "3-6 word summary shown in the UI." },
      prompt: { type: "string", description: "Full instructions for the subagent, including what to return." },
      subagent_type: { type: "string", enum: [...SUBAGENT_TYPES] },
      run_in_background: { type: "boolean" },
    },
    required: ["description", "prompt", "subagent_type"],
  },
  permission: "Task",
  readOnly: true,
  summarize: (a) => `${a.subagent_type}: ${a.description}`,
  permissionSubject: (a) => a.subagent_type,
  async execute(args, ctx) {
    if (!ctx.session.settings.subagentsEnabled) return { output: "Subagents are disabled in settings.", isError: true };
    const rec = await ctx.session.tasks.spawnSubagent({
      description: args.description,
      prompt: args.prompt,
      subagentType: args.subagent_type,
      background: Boolean(args.run_in_background),
    });
    if (rec.status === "running") {
      return {
        output: `Spawned ${rec.subagentType} subagent ${rec.id} in the background. Poll with get_task_output ids=["${rec.id}"].`,
        display: { kind: "task", taskId: rec.id, subagent: rec.subagentType ?? "general", summary: args.description, status: rec.status },
      };
    }
    return {
      output: `Subagent ${rec.id} (${rec.subagentType}) ${rec.status} after ${rec.toolCalls} tool calls in ${Math.round(((rec.endedAt ?? Date.now()) - rec.startedAt) / 1000)}s:\n\n${clampText(rec.output, 40_000)}`,
      isError: rec.status === "error",
      display: { kind: "task", taskId: rec.id, subagent: rec.subagentType ?? "general", summary: args.description, status: rec.status },
    };
  },
};

export const getTaskOutput: ToolDefinition<{ ids: string[]; timeout_ms?: number }> = {
  id: "get_task_output",
  title: "get_task_output",
  category: "workflow",
  description: "Poll (timeout_ms omitted/0) or wait (timeout_ms > 0) for background tasks: subagent ids (task_…) or background processes (proc_…). Max 20 ids.",
  parameters: {
    type: "object",
    properties: {
      ids: { type: "array", items: { type: "string" } },
      timeout_ms: { type: "number", description: "Wait up to this long for completion. 0 = non-blocking poll." },
    },
    required: ["ids"],
  },
  permission: null,
  readOnly: true,
  summarize: (a) => a.ids.join(", "),
  async execute(args, ctx) {
    const ids = [...new Set(args.ids.map((s) => s.trim()).filter(Boolean))].slice(0, 20);
    const timeout = Math.min(Math.max(args.timeout_ms ?? 0, 0), 300_000);
    const sections: string[] = [];
    for (const id of ids) {
      if (id.startsWith("proc_")) {
        const p = ctx.session.processes.get(id);
        if (!p) { sections.push(`## ${id}\nUnknown process id.`); continue; }
        if (timeout > 0 && p.exitCode === null) await Promise.race([p.done, new Promise((r) => setTimeout(r, timeout))]);
        sections.push(`## ${id}\nstatus: ${p.exitCode === null ? "running" : `exited ${p.exitCode}`}\n\`\`\`\n${clampText(p.output.slice(-20_000), 20_000)}\n\`\`\``);
      } else {
        const t = timeout > 0 ? await ctx.session.tasks.wait(id, timeout) : ctx.session.tasks.get(id);
        if (!t) { sections.push(`## ${id}\nUnknown task id.`); continue; }
        sections.push(`## ${id} (${t.subagentType ?? t.kind})\nstatus: ${t.status}\n${t.status === "running" ? "(still running)" : clampText(t.output, 30_000)}`);
      }
    }
    return { output: sections.join("\n\n") || "No ids given." };
  },
};
