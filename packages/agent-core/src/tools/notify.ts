import type { ToolDefinition } from "../types.js";
import { run } from "./screen-proc.js";

interface NotifyArgs {
  title: string;
  message: string;
}

export const notifyTool: ToolDefinition<NotifyArgs> = {
  id: "notify",
  title: "notify",
  category: "external",
  description: "Display a native desktop notification to alert the user when a long task completes or needs review.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Notification title (e.g. 'Task Complete')." },
      message: { type: "string", description: "Notification body message." },
    },
    required: ["title", "message"],
  },
  permission: null,
  readOnly: true,
  summarize: (a) => `notify "${a.title ?? ""}"`,
  async execute(args) {
    const title = String(args.title ?? "Nimbus").replace(/"/g, '\\"');
    const msg = String(args.message ?? "").replace(/"/g, '\\"');

    if (process.platform === "darwin") {
      const script = `display notification "${msg}" with title "${title}"`;
      try {
        await run("osascript", ["-e", script]);
        return { output: `Notification sent: "${args.title}"` };
      } catch (e) {
        return { output: `Failed to show notification: ${(e as Error).message}`, isError: true };
      }
    }

    if (process.platform === "win32") {
      const ps = `[reflection.assembly]::loadwithpartialname('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show('${msg}', '${title}')`;
      try {
        await run("powershell", ["-Command", ps]);
        return { output: `Notification shown: "${args.title}"` };
      } catch (e) {
        return { output: `Failed to show notification: ${(e as Error).message}`, isError: true };
      }
    }

    if (process.platform === "linux") {
      try {
        await run("notify-send", [title, msg]);
        return { output: `Notification sent: "${args.title}"` };
      } catch {
        return { output: `Notification could not be displayed (notify-send missing).` };
      }
    }

    return { output: "Notification not supported on this OS.", isError: true };
  },
};
