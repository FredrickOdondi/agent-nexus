import type { ToolDefinition } from "../types.js";
import { run } from "./screen-proc.js";

interface BrowserArgs {
  action: "open" | "get_page" | "click_selector" | "type_selector" | "evaluate";
  url?: string;
  selector?: string;
  text?: string;
  expression?: string;
  browser?: "chrome" | "safari" | "default";
}

export const browserTool: ToolDefinition<BrowserArgs> = {
  id: "browser",
  title: "browser",
  category: "external",
  description: [
    "Inspect and control web browsers (Google Chrome or Safari).",
    "Actions:",
    "- open: Navigate to or open a URL (url).",
    "- get_page: Read the active tab's URL, title, and main text content via DOM.",
    "- click_selector: Click an element on the active page by CSS selector (selector, e.g. '#submit', 'button.login').",
    "- type_selector: Fill an input element by CSS selector with text (selector, text).",
    "- evaluate: Run arbitrary JavaScript in the active web page and return the result (expression).",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["open", "get_page", "click_selector", "type_selector", "evaluate"], description: "Browser action." },
      url: { type: "string", description: "URL to open." },
      selector: { type: "string", description: "CSS selector for click_selector or type_selector (e.g. 'input[name=q]', 'button.btn-primary')." },
      text: { type: "string", description: "Text to type into the selected input element." },
      expression: { type: "string", description: "JavaScript expression to evaluate in the page." },
      browser: { type: "string", enum: ["chrome", "safari", "default"], description: "Target browser (defaults to chrome, falls back to safari)." },
    },
    required: ["action"],
  },
  permission: "Computer",
  readOnly: false,
  summarize: (a) => `${a.action} ${a.url ?? a.selector ?? ""}`.trim(),
  permissionSubject: (a) => a.url || a.selector || a.action,
  async execute(args) {
    const { action, url, selector, text, expression } = args;

    if (action === "open") {
      if (!url) return { output: "open action requires a url.", isError: true };
      const targetUrl = url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
      if (process.platform === "darwin") {
        if (args.browser === "safari") {
          await run("open", ["-a", "Safari", targetUrl]);
        } else {
          try {
            await run("open", ["-a", "Google Chrome", targetUrl]);
          } catch {
            await run("open", [targetUrl]);
          }
        }
        return { output: `Opened ${targetUrl}.` };
      }
      if (process.platform === "win32") {
        await run("powershell", ["-Command", `Start-Process "${targetUrl}"`]);
        return { output: `Opened ${targetUrl}.` };
      }
      await run("xdg-open", [targetUrl]);
      return { output: `Opened ${targetUrl}.` };
    }

    if (process.platform === "darwin") {
      // Determine target browser
      const isSafari = args.browser === "safari";
      const appName = isSafari ? "Safari" : "Google Chrome";

      const runJs = async (jsCode: string) => {
        const escaped = jsCode.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const script = isSafari
          ? `tell application "Safari" to do JavaScript "${escaped}" in current tab of front window`
          : `tell application "Google Chrome" to execute front window's active tab javascript "${escaped}"`;
        const { stdout } = await run("osascript", ["-e", script]);
        return stdout.trim();
      };

      if (action === "get_page") {
        try {
          const infoScript = isSafari
            ? `tell application "Safari" to return (URL of current tab of front window) & "|||" & (name of current tab of front window)`
            : `tell application "Google Chrome" to return (URL of active tab of front window) & "|||" & (title of active tab of front window)`;
          const { stdout: info } = await run("osascript", ["-e", infoScript]);
          const [currentUrl, pageTitle] = info.trim().split("|||");

          // Read page text snippet via DOM
          const textContent = await runJs(`
            (() => {
              const body = document.body;
              if (!body) return '';
              return (body.innerText || '').slice(0, 4000);
            })()
          `).catch(() => "");

          return {
            output: [
              `URL: ${currentUrl ?? "unknown"}`,
              `Title: ${pageTitle ?? "unknown"}`,
              `\nPage Content:\n${textContent || "(no text content)"}`,
            ].join("\n"),
          };
        } catch (e) {
          return {
            output: `Could not inspect ${appName}: ${(e as Error).message}. (Ensure ${appName} is running and has 'Allow JavaScript from Apple Events' enabled in View → Developer).`,
            isError: true,
          };
        }
      }

      if (action === "click_selector") {
        if (!selector) return { output: "click_selector requires a CSS selector.", isError: true };
        try {
          const res = await runJs(`
            (() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return 'NOT_FOUND';
              el.scrollIntoView({ block: 'center', inline: 'center' });
              el.click();
              return 'CLICKED';
            })()
          `);
          if (res === "NOT_FOUND") return { output: `No element found matching selector "${selector}".`, isError: true };
          return { output: `Clicked element matching "${selector}".` };
        } catch (e) {
          return { output: `Failed to click selector "${selector}": ${(e as Error).message}`, isError: true };
        }
      }

      if (action === "type_selector") {
        if (!selector) return { output: "type_selector requires a CSS selector.", isError: true };
        try {
          const res = await runJs(`
            (() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return 'NOT_FOUND';
              el.focus();
              el.value = ${JSON.stringify(text ?? "")};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return 'TYPED';
            })()
          `);
          if (res === "NOT_FOUND") return { output: `No element found matching selector "${selector}".`, isError: true };
          return { output: `Typed text into "${selector}".` };
        } catch (e) {
          return { output: `Failed to type into "${selector}": ${(e as Error).message}`, isError: true };
        }
      }

      if (action === "evaluate") {
        if (!expression) return { output: "evaluate requires a JavaScript expression.", isError: true };
        try {
          const res = await runJs(`
            (() => {
              try {
                const out = eval(${JSON.stringify(expression)});
                return typeof out === 'object' ? JSON.stringify(out) : String(out);
              } catch (err) {
                return 'ERROR: ' + err.message;
              }
            })()
          `);
          return { output: res };
        } catch (e) {
          return { output: `JavaScript evaluation failed: ${(e as Error).message}`, isError: true };
        }
      }
    }

    return { output: `Browser action "${action}" is not supported on this OS without macOS Apple Events.`, isError: true };
  },
};
