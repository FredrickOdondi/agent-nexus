import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolDefinition } from "../types.js";
import { exists } from "../util/fs.js";

interface SubagentManageArgs {
  action: "create" | "list" | "read" | "delete";
  name?: string;
  description?: string;
  prompt?: string;
  tools?: string[];
  model?: string;
  avatar?: string;
  scope?: "local" | "user";
}

export const subagentManageTool: ToolDefinition<SubagentManageArgs> = {
  id: "subagent_manage",
  title: "subagent_manage",
  category: "workflow",
  description:
    "Manage custom subagents. Actions: 'create' (create or update a subagent in .nimbus/subagents/<name>.md with instructions and allowed tools), " +
    "'list' (list all custom and built-in subagents), 'read' (inspect prompt instructions and tools for a subagent), " +
    "'delete' (remove a custom subagent). Once created, users can invoke them via '/<name>' in the chat or you can delegate to them with 'task'.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["create", "list", "read", "delete"] },
      name: { type: "string", description: "Subagent identifier (e.g. 'code-auditor', 'test-gen', 'frontend-reviewer')." },
      description: { type: "string", description: "Short description displayed in slash commands and UI." },
      prompt: { type: "string", description: "System prompt instructions defining how this subagent should operate." },
      tools: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of allowed tool names (e.g. ['glob', 'read_file', 'grep']). If omitted, inherits standard subagent tools.",
      },
      model: { type: "string", description: "Optional model override." },
      avatar: { type: "string", description: "Optional avatar colorway or mascot theme (e.g. 'indigo', 'sunset', 'mint', 'sky', 'cherry')." },
      scope: { type: "string", enum: ["local", "user"], description: "Scope to save in. 'local' (.nimbus/subagents/ in workspace) or 'user' (~/.nimbus/subagents/)." },
    },
    required: ["action"],
  },
  permission: "Task",
  readOnly: false,
  summarize: (a) => `subagent_manage: ${a.action} ${a.name ?? ""}`.trim(),
  permissionSubject: (a) => a.name ?? a.action,
  async execute(args, ctx) {
    if (args.action === "list") {
      const all = await ctx.session.subagents.list();
      if (!all.length) return { output: "No subagents found." };
      const lines = all.map(
        (s) => `- /${s.name} [${s.scope ?? "custom"}]: ${s.description}${s.tools?.length ? ` (tools: ${s.tools.join(", ")})` : ""}${s.model ? ` (model: ${s.model})` : ""}`,
      );
      return { output: `Registered subagents (${all.length}):\n${lines.join("\n")}` };
    }

    if (!args.name) {
      return { output: "A subagent 'name' is required for action: " + args.action, isError: true };
    }

    const cleanName = args.name.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
    if (!cleanName) {
      return { output: "Invalid subagent name. Use alphanumeric characters, hyphens, and underscores.", isError: true };
    }

    if (args.action === "read") {
      const s = await ctx.session.subagents.load(cleanName);
      if (!s) return { output: `Subagent '${cleanName}' not found.`, isError: true };
      return {
        output: [
          `Subagent: /${s.name}`,
          `Scope: ${s.scope ?? "custom"}`,
          `Path: ${s.path ?? "builtin"}`,
          `Description: ${s.description}`,
          s.tools?.length ? `Tools: ${s.tools.join(", ")}` : "Tools: standard subagent toolset",
          s.model ? `Model: ${s.model}` : "Model: default workspace model",
          "\nInstructions / System Prompt:",
          s.prompt ?? "(No custom prompt specified)",
        ].join("\n"),
      };
    }

    if (args.action === "delete") {
      const s = await ctx.session.subagents.load(cleanName);
      if (!s) return { output: `Subagent '${cleanName}' not found.`, isError: true };
      if (s.scope === "builtin" || !s.path) {
        return { output: `Cannot delete built-in subagent '${cleanName}'.`, isError: true };
      }
      if (await exists(s.path)) {
        await fs.unlink(s.path);
        await ctx.session.onSubagentsChanged?.();
        return { output: `Deleted custom subagent '${cleanName}' at ${s.path}.` };
      }
      return { output: `Subagent file not found at ${s.path}.`, isError: true };
    }

    if (args.action === "create") {
      if (!args.description) {
        return { output: "A 'description' is required to create a subagent.", isError: true };
      }
      if (!args.prompt) {
        return { output: "A 'prompt' (instructions) is required to create a subagent.", isError: true };
      }

      // Enforce Freemium subscription limit (default max 2 custom subagents on Free plan)
      const allSubagents = await ctx.session.subagents.list().catch(() => []);
      const existing = await ctx.session.subagents.load(cleanName).catch(() => null);
      const customSubagents = allSubagents.filter((s) => s.scope !== "builtin" && s.name !== cleanName);
      const isPro = ctx.session.subscription?.tier === "pro";
      const maxSubagents = ctx.session.limits?.maxSubagents ?? 2;

      if (!isPro && !existing && customSubagents.length >= maxSubagents) {
        return {
          output:
            `SUBSCRIPTION LIMIT REACHED: The user is on the Free plan, which is limited to ${maxSubagents} custom subagents. ` +
            `There are already ${customSubagents.length} custom subagents configured (${customSubagents.map((s) => '/' + s.name).join(", ")}). ` +
            `Creation of subagent '/${cleanName}' is blocked. Inform the user that they have reached the Free limit and need to upgrade to Nimbus Pro or activate their 14-day free trial in Settings → Plan & Billing for unlimited custom subagents.`,
          isError: true,
        };
      }

      const scope = args.scope ?? "local";
      const targetDir = scope === "user"
        ? path.join(os.homedir(), ".nimbus/subagents")
        : path.join(ctx.cwd, ".nimbus/subagents");
      await fs.mkdir(targetDir, { recursive: true });

      const filePath = path.join(targetDir, `${cleanName}.md`);
      const lines: string[] = ["---", `name: ${cleanName}`, `description: "${args.description.replace(/"/g, '\\"')}"`];
      if (args.avatar) {
        lines.push(`avatar: ${args.avatar}`);
      }
      if (args.tools && args.tools.length > 0) {
        lines.push(`tools: ${args.tools.join(", ")}`);
      }
      if (args.model) {
        lines.push(`model: ${args.model}`);
      }
      lines.push("---", "", args.prompt.trim(), "");

      await fs.writeFile(filePath, lines.join("\n"), "utf8");
      // Also ensure ~/.nimbus/subagents has a copy so it's always discovered globally
      const userDir = path.join(os.homedir(), ".nimbus/subagents");
      await fs.mkdir(userDir, { recursive: true }).catch(() => {});
      await fs.writeFile(path.join(userDir, `${cleanName}.md`), lines.join("\n"), "utf8").catch(() => {});

      await ctx.session.onSubagentsChanged?.();
      return {
        output: `Created subagent '/${cleanName}' successfully at ${filePath}.\nUsers can now invoke it with /${cleanName} in the chat, and you can delegate tasks to it using task with subagent_type="${cleanName}".`,
      };
    }

    return { output: `Unknown action: ${(args as any).action}`, isError: true };
  },
};
