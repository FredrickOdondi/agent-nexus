import type { ToolDefinition } from "../types.js";
import { run } from "./screen-proc.js";

interface AppArgs {
  action: "open" | "list_windows" | "focus" | "quit";
  name?: string;
}

export const appsTool: ToolDefinition<AppArgs> = {
  id: "apps",
  title: "apps",
  category: "external",
  description: [
    "Manage and inspect desktop applications and windows.",
    "Actions:",
    "- open: Launch or activate an application by name (e.g. name: 'Google Chrome', 'Slack', 'Terminal').",
    "- list_windows: List currently open applications and their window titles.",
    "- focus: Bring a specific window/app to the front.",
    "- quit: Terminate or close an application gracefully.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["open", "list_windows", "focus", "quit"], description: "Action to perform on apps." },
      name: { type: "string", description: "Name of the app (e.g. 'Google Chrome', 'Finder', 'Slack')." },
    },
    required: ["action"],
  },
  permission: "Computer",
  readOnly: false,
  summarize: (a) => `${a.action} ${a.name ?? ""}`.trim(),
  permissionSubject: (a) => a.name || a.action,
  async execute(args) {
    const { action, name } = args;

    if (process.platform === "darwin") {
      if (action === "open") {
        if (!name) return { output: "open action requires an app name.", isError: true };
        try {
          await run("open", ["-a", name]);
          return { output: `Opened application "${name}".` };
        } catch (e) {
          return { output: `Could not open application "${name}": ${(e as Error).message}`, isError: true };
        }
      }

      if (action === "list_windows") {
        const script = `
tell application "System Events"
  set winList to {}
  repeat with proc in (every process whose visible is true)
    set procName to name of proc
    repeat with win in (every window of proc)
      set end of winList to (procName & " — " & (name of win))
    end repeat
  end repeat
  return winList
end tell
        `.trim();
        try {
          const { stdout } = await run("osascript", ["-e", script]);
          const lines = stdout.split(", ").map((s) => s.trim()).filter(Boolean);
          if (lines.length === 0) return { output: "No visible application windows found." };
          return { output: `Open windows:\n` + lines.map((l) => `- ${l}`).join("\n") };
        } catch (e) {
          return { output: `Failed to list windows: ${(e as Error).message}`, isError: true };
        }
      }

      if (action === "focus") {
        if (!name) return { output: "focus action requires an app name.", isError: true };
        const script = `tell application "${name.replace(/"/g, '\\"')}" to activate`;
        try {
          await run("osascript", ["-e", script]);
          return { output: `Focused application "${name}".` };
        } catch (e) {
          return { output: `Could not focus "${name}": ${(e as Error).message}`, isError: true };
        }
      }

      if (action === "quit") {
        if (!name) return { output: "quit action requires an app name.", isError: true };
        const script = `tell application "${name.replace(/"/g, '\\"')}" to quit`;
        try {
          await run("osascript", ["-e", script]);
          return { output: `Quit application "${name}".` };
        } catch (e) {
          return { output: `Could not quit "${name}": ${(e as Error).message}`, isError: true };
        }
      }
    }

    if (process.platform === "win32") {
      if (action === "open") {
        if (!name) return { output: "open action requires an app name.", isError: true };
        await run("powershell", ["-Command", `Start-Process "${name}"`]);
        return { output: `Launched ${name}.` };
      }
      if (action === "list_windows") {
        const { stdout } = await run("powershell", [
          "-Command",
          "Get-Process | Where-Object { $_.MainWindowTitle } | Select-Object ProcessName, MainWindowTitle | Format-Table -HideTableHeaders",
        ]);
        return { output: stdout.trim() || "No windows found." };
      }
    }

    return { output: `App management action "${action}" not implemented for platform ${process.platform}.`, isError: true };
  },
};
