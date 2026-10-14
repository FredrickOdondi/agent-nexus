import type { ToolDefinition } from "../types.js";
import { run } from "./screen-proc.js";

interface AppleScriptArgs {
  script: string;
  language?: "applescript" | "javascript";
}

export const applescriptTool: ToolDefinition<AppleScriptArgs> = {
  id: "applescript",
  title: "applescript",
  category: "external",
  description: [
    "Run AppleScript or JXA (JavaScript for Automation) to control macOS applications, Finder, system dialogs, and native apps directly.",
    "Much faster and more reliable than clicking UI elements for scriptable Mac apps like Safari, Mail, Calendar, Notes, Finder, and System Events.",
    "Only available on macOS.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      script: { type: "string", description: "The AppleScript or JXA code to execute." },
      language: { type: "string", enum: ["applescript", "javascript"], description: "Language to use. Defaults to applescript." },
    },
    required: ["script"],
  },
  permission: "Bash",
  readOnly: false,
  summarize: (a) => `osascript ${(a.script ?? "").slice(0, 40)}`,
  async execute(args) {
    if (process.platform !== "darwin") {
      return { output: "AppleScript is only available on macOS.", isError: true };
    }
    const script = String(args.script ?? "").trim();
    if (!script) return { output: "No script provided.", isError: true };

    const cmdArgs = args.language === "javascript" ? ["-l", "JavaScript", "-e", script] : ["-e", script];
    try {
      const { stdout, stderr } = await run("osascript", cmdArgs, 30_000);
      const out = (stdout || stderr || "Execution succeeded with no output.").trim();
      return { output: out };
    } catch (e) {
      return { output: `AppleScript failed: ${(e as Error).message}`, isError: true };
    }
  },
};
