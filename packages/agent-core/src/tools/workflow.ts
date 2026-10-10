import type { QuestionOption, TodoItem } from "@nimbus/shared";
import type { ToolDefinition } from "../types.js";

export const todoWrite: ToolDefinition<{ todos: TodoItem[]; merge?: boolean }> = {
  id: "todo_write",
  title: "todo_write",
  category: "workflow",
  description:
    "Create or update the session task list shown to the user. Use for multi-step work: mark exactly one item in_progress, complete items as soon as they are done. With merge=true, items are merged by id.",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
          },
          required: ["id", "content", "status"],
        },
      },
      merge: { type: "boolean" },
    },
    required: ["todos"],
  },
  permission: null,
  readOnly: true,
  summarize: (a) => `${a.todos.length} items`,
  async execute(args, ctx) {
    let next = args.todos;
    if (args.merge) {
      const map = new Map(ctx.session.getTodos().map((t) => [t.id, t]));
      for (const t of args.todos) map.set(t.id, { ...map.get(t.id), ...t });
      next = [...map.values()];
    }
    ctx.session.setTodos(next);
    const lines = next.map((t) => `- [${t.status === "completed" ? "x" : t.status === "in_progress" ? "~" : " "}] ${t.content}`);
    return { output: lines.join("\n"), display: { kind: "todos", todos: next } };
  },
};

export const askUserQuestion: ToolDefinition<{ question: string; options: QuestionOption[]; allow_freeform?: boolean }> = {
  id: "ask_user_question",
  title: "ask_user_question",
  category: "workflow",
  description:
    "Ask the user a structured question when the task is ambiguous (design direction, framework, schema…). Provide 2-5 concise options. Execution pauses until the user answers. Do not use for permission requests.",
  parameters: {
    type: "object",
    properties: {
      question: { type: "string" },
      options: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string" }, description: { type: "string" } },
          required: ["label"],
        },
      },
      allow_freeform: { type: "boolean", description: "Let the user type a custom answer. Default true." },
    },
    required: ["question", "options"],
  },
  permission: null,
  readOnly: true,
  summarize: (a) => a.question,
  async execute(args, ctx) {
    const answer = await ctx.session.askUser(args.question, args.options.slice(0, 6), args.allow_freeform ?? true);
    return { output: `User answered: ${answer}` };
  },
};

export const memoryTool: ToolDefinition<{ action: "read" | "append"; scope?: "global" | "workspace"; text?: string }> = {
  id: "memory",
  title: "memory",
  category: "workflow",
  description:
    "Cross-session memory stored as Markdown (global MEMORY.md or per-workspace MEMORY.md). Append durable facts: user preferences, project conventions, decisions, debugging insights. Read it when context about past sessions would help.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "append"] },
      scope: { type: "string", enum: ["global", "workspace"], description: "Default workspace." },
      text: { type: "string", description: "Markdown to append (for action=append)." },
    },
    required: ["action"],
  },
  permission: null,
  readOnly: true,
  summarize: (a) => `${a.action} ${a.scope ?? "workspace"}`,
  async execute(args, ctx) {
    const scope = args.scope ?? "workspace";
    if (args.action === "read") {
      const text = await ctx.session.memory.read(scope);
      return { output: text || "(memory is empty)", display: { kind: "memory", scope, text } };
    }
    if (!args.text?.trim()) return { output: "Nothing to append.", isError: true };
    await ctx.session.memory.append(scope, args.text.trim());
    return { output: `Saved to ${scope} memory.`, display: { kind: "memory", scope, text: args.text.trim() } };
  },
};

export const enterPlanMode: ToolDefinition<{ reason?: string }> = {
  id: "enter_plan_mode",
  title: "enter_plan_mode",
  category: "workflow",
  description: "Enter plan mode for complex or risky tasks. While active, file edits and commands are blocked; explore the codebase, then present a step-by-step plan and call exit_plan_mode to request approval.",
  parameters: { type: "object", properties: { reason: { type: "string" } } },
  permission: null,
  readOnly: true,
  summarize: () => "plan mode",
  async execute(_args, ctx) {
    ctx.session.planMode.enter();
    return { output: "Plan mode active. Research freely with read-only tools, then call exit_plan_mode with the full plan.", display: { kind: "plan", mode: "enter" } };
  },
};

export const exitPlanMode: ToolDefinition<{ plan: string }> = {
  id: "exit_plan_mode",
  title: "exit_plan_mode",
  category: "workflow",
  description: "Present the finished plan (Markdown) and ask the user to approve it. If approved, plan mode ends and you may implement. If rejected, revise the plan.",
  parameters: { type: "object", properties: { plan: { type: "string", description: "The complete plan in Markdown." } }, required: ["plan"] },
  permission: null,
  readOnly: true,
  summarize: () => "approve plan",
  async execute(args, ctx) {
    const approved = await ctx.session.planMode.exit(args.plan);
    return {
      output: approved ? "Plan approved. Plan mode ended — proceed with implementation." : "Plan rejected by the user. Ask what to change or revise the plan.",
      display: { kind: "plan", mode: "exit", plan: args.plan },
    };
  },
};

export const skillTool: ToolDefinition<{ name: string }> = {
  id: "skill",
  title: "skill",
  category: "workflow",
  description: "Load a skill (SKILL.md) into context by name. Skills are reusable procedures discovered from .nimbus/skills, .grok/skills and ~/.nimbus/skills. Use when a task matches a skill description.",
  parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  permission: null,
  readOnly: true,
  summarize: (a) => a.name,
  async execute(args, ctx) {
    const body = await ctx.session.skills.load(args.name);
    if (!body) {
      const all = await ctx.session.skills.list();
      return { output: `Skill "${args.name}" not found. Available: ${all.map((s) => s.name).join(", ") || "none"}`, isError: true };
    }
    return { output: body };
  },
};
