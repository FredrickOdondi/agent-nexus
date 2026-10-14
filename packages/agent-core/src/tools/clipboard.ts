import { spawn } from "node:child_process";
import type { ToolDefinition } from "../types.js";
import { run } from "./screen-proc.js";

interface ClipboardArgs {
  action: "read" | "write";
  text?: string;
}

export const clipboardTool: ToolDefinition<ClipboardArgs> = {
  id: "clipboard",
  title: "clipboard",
  category: "external",
  description: [
    "Read or write text to the system clipboard.",
    "Actions:",
    "- read: Returns the current plain text stored in the clipboard.",
    "- write: Sets new text into the clipboard (requires 'text' parameter).",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["read", "write"], description: "Whether to read or write." },
      text: { type: "string", description: "Text content to copy to clipboard when action is 'write'." },
    },
    required: ["action"],
  },
  permission: "Computer",
  readOnly: false,
  summarize: (a) => (a.action === "write" ? `copy ${(a.text ?? "").slice(0, 30)}` : "read clipboard"),
  async execute(args) {
    if (args.action === "read") {
      if (process.platform === "darwin") {
        const { stdout } = await run("pbpaste", []);
        return { output: stdout || "(clipboard is empty)" };
      }
      if (process.platform === "win32") {
        const { stdout } = await run("powershell", ["-Command", "Get-Clipboard"]);
        return { output: stdout.trim() || "(clipboard is empty)" };
      }
      if (process.platform === "linux") {
        const { stdout } = await run("xclip", ["-selection", "clipboard", "-o"]).catch(() => run("wl-paste", []));
        return { output: stdout || "(clipboard is empty)" };
      }
      return { output: "Clipboard not supported on this OS.", isError: true };
    }

    if (args.action === "write") {
      const text = args.text ?? "";
      if (process.platform === "darwin") {
        await new Promise<void>((resolve, reject) => {
          const child = spawn("pbcopy");
          child.stdin.write(text);
          child.stdin.end();
          child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("pbcopy failed"))));
        });
        return { output: `Copied ${text.length} characters to clipboard.` };
      }
      if (process.platform === "win32") {
        await run("powershell", ["-Command", `Set-Clipboard -Value "${text.replace(/"/g, '`"')}"`]);
        return { output: `Copied ${text.length} characters to clipboard.` };
      }
      if (process.platform === "linux") {
        await new Promise<void>((resolve, reject) => {
          const child = spawn("xclip", ["-selection", "clipboard"]);
          child.stdin.write(text);
          child.stdin.end();
          child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("xclip failed"))));
        });
        return { output: `Copied ${text.length} characters to clipboard.` };
      }
      return { output: "Clipboard write not supported on this OS.", isError: true };
    }

    return { output: `Unknown clipboard action: ${String(args.action)}`, isError: true };
  },
};
