import type { ToolDefinition } from "../types.js";
import { commandExists, run } from "./screen-proc.js";

interface BrowserArgs {
  action:
    | "open"
    | "snapshot"
    | "click"
    | "fill"
    | "screenshot"
    | "get_page"
    | "click_selector"
    | "type_selector"
    | "evaluate"
    | "close";
  url?: string;
  ref?: string;
  selector?: string;
  text?: string;
  expression?: string;
  path?: string;
  headed?: boolean;
  profile?: string;
  autoConnect?: boolean;
  interactiveOnly?: boolean;
}

function normalizeRef(refOrSelector: string): string {
  const trimmed = refOrSelector.trim();
  if (/^e\d+$/i.test(trimmed)) {
    return `@${trimmed.toLowerCase()}`;
  }
  return trimmed;
}

export const browserTool: ToolDefinition<BrowserArgs> = {
  id: "browser",
  title: "browser",
  category: "external",
  description: [
    "CRITICAL: USE PROACTIVELY. Whenever a user request requires interacting with any website, SaaS platform, web app, or online service that is not directly available via Composio or direct APIs, immediately invoke this tool without asking the user for confirmation or waiting to be told. The user expects you to autonomously navigate and perform actions.",
    "High-performance browser automation CLI & engine powered exclusively by agent-browser (Chromium/CDP).",
    "Actions:",
    "- open: Navigate to a URL (url, optional headed, optional profile e.g. 'Default' to reuse Chrome logins, optional autoConnect). Automatically returns the interactive element snapshot.",
    "- snapshot: Capture accessibility tree with numbered element refs (@e1, @e2) for targeted interactions.",
    "- click: Click an element by reference (@e1) or CSS selector (ref or selector).",
    "- fill: Fill an input element by reference (@e1) or CSS selector with text (ref or selector, text).",
    "- screenshot: Capture page screenshot (path, optional).",
    "- evaluate: Evaluate JavaScript expression in the browser session (expression).",
    "- close: Close active browser session and terminate daemon.",
    "- get_page: Alias for snapshot / page element extraction.",
    "- click_selector: Alias for click.",
    "- type_selector: Alias for fill.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: [
          "open",
          "snapshot",
          "click",
          "fill",
          "screenshot",
          "get_page",
          "click_selector",
          "type_selector",
          "evaluate",
          "close",
        ],
        description: "Browser action to execute via agent-browser.",
      },
      url: { type: "string", description: "URL to open." },
      ref: { type: "string", description: "Element reference from snapshot (e.g. '@e1', '@e2')." },
      selector: { type: "string", description: "CSS selector fallback (e.g. '#submit', 'input[name=q]')." },
      text: { type: "string", description: "Text to type or fill into target element." },
      expression: { type: "string", description: "JavaScript expression to evaluate in the page." },
      path: { type: "string", description: "File path to save screenshot." },
      headed: { type: "boolean", description: "Show visible browser window on screen (defaults to headless)." },
      profile: { type: "string", description: "Chrome profile name (e.g. 'Default') to reuse saved logins and cookies." },
      autoConnect: { type: "boolean", description: "Auto-connect to an already-running Chrome instance." },
      interactiveOnly: { type: "boolean", description: "Filter snapshot to interactive elements only (default true)." },
    },
    required: ["action"],
  },
  permission: "WebFetch",
  readOnly: true,
  summarize: (a) => `${a.action} ${a.url ?? a.ref ?? a.selector ?? ""}`.trim(),
  permissionSubject: (a) => a.url || a.ref || a.selector || a.action,
  async execute(args) {
    const { action, url, text, expression } = args;
    const targetRefOrSelector = args.ref ? normalizeRef(args.ref) : args.selector ? normalizeRef(args.selector) : undefined;

    const hasAgentBrowser = await commandExists("agent-browser");
    if (!hasAgentBrowser) {
      return {
        output: "agent-browser CLI is the required browser tool. Please install it with: npm install -g agent-browser && agent-browser install",
        isError: true,
      };
    }

    try {
      if (action === "open") {
        if (!url) return { output: "open action requires a url.", isError: true };
        const targetUrl = url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
        const openArgs = ["open", targetUrl];
        if (args.headed) openArgs.push("--headed");
        if (args.profile) openArgs.push("--profile", args.profile);
        if (args.autoConnect) openArgs.push("--auto-connect");

        const { stdout: openOut } = await run("agent-browser", openArgs, 30_000);

        // Follow with an immediate interactive snapshot to orient the agent
        let snapshotOut = "";
        try {
          const snap = await run("agent-browser", ["snapshot", "-i"], 10_000);
          snapshotOut = snap.stdout.trim();
        } catch {
          // Non-fatal if snapshot fails
        }

        const combined = [
          openOut.trim(),
          snapshotOut ? `\nPage Elements:\n${snapshotOut}` : "",
        ].filter(Boolean).join("\n");

        return { output: combined };
      }

      if (action === "snapshot" || action === "get_page") {
        const snapArgs = ["snapshot"];
        if (args.interactiveOnly !== false) {
          snapArgs.push("-i");
        }
        const { stdout } = await run("agent-browser", snapArgs, 15_000);
        return { output: stdout.trim() || "(empty snapshot)" };
      }

      if (action === "click" || action === "click_selector") {
        if (!targetRefOrSelector) {
          return { output: "click action requires a ref (e.g. '@e1') or selector.", isError: true };
        }
        const { stdout } = await run("agent-browser", ["click", targetRefOrSelector], 15_000);
        return { output: stdout.trim() || `Clicked ${targetRefOrSelector}.` };
      }

      if (action === "fill" || action === "type_selector") {
        if (!targetRefOrSelector) {
          return { output: "fill action requires a ref (e.g. '@e1') or selector.", isError: true };
        }
        const fillText = text ?? "";
        const { stdout } = await run("agent-browser", ["fill", targetRefOrSelector, fillText], 15_000);
        return { output: stdout.trim() || `Filled ${targetRefOrSelector}.` };
      }

      if (action === "screenshot") {
        const scArgs = ["screenshot"];
        if (args.path) scArgs.push(args.path);
        const { stdout } = await run("agent-browser", scArgs, 20_000);
        return { output: stdout.trim() || "Screenshot captured." };
      }

      if (action === "evaluate") {
        if (!expression) return { output: "evaluate requires a JavaScript expression.", isError: true };
        const { stdout } = await run("agent-browser", ["eval", expression], 15_000);
        return { output: stdout.trim() };
      }

      if (action === "close") {
        const { stdout } = await run("agent-browser", ["close"], 10_000);
        return { output: stdout.trim() || "Browser closed." };
      }

      return { output: `Unknown browser action: ${action}`, isError: true };
    } catch (err) {
      return {
        output: `agent-browser error: ${(err as Error).message}`,
        isError: true,
      };
    }
  },
};

