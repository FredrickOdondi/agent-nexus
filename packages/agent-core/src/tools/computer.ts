import type { ToolDefinition } from "../types.js";
import { supportsVision } from "../providers/index.js";
import {
  captureScreen,
  currentFrame,
  currentPerception,
  locate,
  performAction,
  settle,
  type Shot,
} from "./screen.js";
import { formatElementsForPrompt, type ScreenElement } from "./screen-perception.js";

const ACTIONS = [
  "screenshot",
  "read_screen",
  "click_element",
  "type_into",
  "find_text",
  "wait_for",
  "zoom",
  "click",
  "double_click",
  "right_click",
  "move",
  "scroll",
  "type",
  "key",
  "drag",
] as const;

type Action = (typeof ACTIONS)[number];

interface ComputerArgs {
  action: Action;
  x?: number;
  y?: number;
  to_x?: number;
  to_y?: number;
  text?: string;
  key?: string;
  /** Positive scrolls down, negative scrolls up. */
  scroll_y?: number;
  /** Element ID from read_screen or Set-of-Marks labels. */
  element_id?: number;
  /** Query string for find_text or wait_for. */
  query?: string;
  /** Crop region width for zoom. */
  width?: number;
  /** Crop region height for zoom. */
  height?: number;
  /** Milliseconds to wait for in wait_for (default 5000). */
  timeout_ms?: number;
}

const MAX_TEXT = 4_000;
const MAX_IMAGE_BYTES = 2_000_000;

function finite(value: unknown, name: string): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number.`);
  return n;
}

function optionalPoint(args: ComputerArgs, required: boolean): { x: number; y: number; scaled: boolean } | null {
  if (args.x == null && args.y == null) {
    if (!required) {
      const frame = currentFrame();
      if (!frame) return { x: 0, y: 0, scaled: false };
      return locate(frame.imageWidth / 2, frame.imageHeight / 2);
    }
    return null;
  }
  return locate(finite(args.x, "x"), finite(args.y, "y"));
}

function findElementById(id: number): ScreenElement | undefined {
  const p = currentPerception();
  return p?.elements.find((e) => e.id === id);
}

function shotText(action: string, shot: Shot, where?: { x: number; y: number; scaled: boolean }): string {
  const lines: string[] = [];
  if (where) lines.push(`${action} at screen pixel ${where.x},${where.y}${where.scaled ? "" : " (no earlier screenshot, so this was used as a screen pixel)"}.`);
  else lines.push(`${action}.`);

  if (!shot.isCrop) {
    lines.push(`Screenshot is ${shot.imageWidth}×${shot.imageHeight} pixels. The screen is ${shot.screenWidth}×${shot.screenHeight}, origin ${shot.originX},${shot.originY}.`);
  } else {
    lines.push(`Zoom crop is ${shot.imageWidth}×${shot.imageHeight} pixels at full resolution.`);
  }

  if (shot.perception && shot.perception.elements.length > 0) {
    lines.push("\n" + formatElementsForPrompt(shot.perception));
  }

  lines.push("\nThe image is attached. You can click using 'click_element' with an element ID or coordinate pixels.");
  return lines.join("\n");
}

function asImage(shot: Shot): { url: string } | null {
  if (shot.bytes.length > MAX_IMAGE_BYTES) return null;
  return { url: `data:${shot.mime};base64,${shot.bytes.toString("base64")}` };
}

export const computerTool: ToolDefinition<ComputerArgs> = {
  id: "computer",
  title: "screen",
  category: "external",
  description: [
    "Operate and perceive the computer screen. Call 'read_screen' or 'screenshot' to capture the screen, read UI text/labels, and see numbered elements.",
    "Actions:",
    "- read_screen / screenshot: Captures screen, runs OCR & accessibility analysis, and numbers interactive targets.",
    "- click_element: Click a UI element by its numbered element_id (e.g. element_id: 5).",
    "- type_into: Click an element by element_id and type text into it (element_id, text).",
    "- find_text: Search for text on screen and return its coordinates/element ID (query).",
    "- zoom: Inspect a small region at 1:1 sharp resolution to read fine text (x, y, width, height).",
    "- wait_for: Wait until text appears on screen (query, timeout_ms).",
    "- click, double_click, right_click, move: Act at pixel coordinates (x, y).",
    "- drag: Drag from (x, y) to (to_x, to_y).",
    "- scroll: Scroll at (x, y) with scroll_y (positive scrolls down).",
    "- type: Type text at current focus (text).",
    "- key: Press special key or chord (key, e.g. enter, tab, escape, cmd+c, ctrl+l).",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "What to do on the screen." },
      element_id: { type: "number", description: "Target element number from read_screen / Set-of-Marks labels." },
      query: { type: "string", description: "Text to search or wait for on screen." },
      x: { type: "number", description: "Horizontal pixel in the latest screenshot." },
      y: { type: "number", description: "Vertical pixel in the latest screenshot." },
      to_x: { type: "number", description: "Drag destination x, in screenshot pixels." },
      to_y: { type: "number", description: "Drag destination y, in screenshot pixels." },
      width: { type: "number", description: "Crop width for zoom action (e.g. 400)." },
      height: { type: "number", description: "Crop height for zoom action (e.g. 300)." },
      text: { type: "string", description: "Text to type. Used by action type and type_into." },
      key: { type: "string", description: "Key or chord, such as enter, tab, escape, ctrl+l, cmd+c." },
      scroll_y: { type: "number", description: "Wheel notches. Positive scrolls down. Used by action scroll." },
      timeout_ms: { type: "number", description: "Timeout for wait_for in milliseconds (default 5000)." },
    },
    required: ["action"],
  },
  permission: "Computer",
  readOnly: false,
  summarize: (a) => {
    if (a.action === "click_element") return `click [${a.element_id}]`;
    if (a.action === "type_into") return `type into [${a.element_id}] "${(a.text ?? "").slice(0, 30)}"`;
    if (a.action === "find_text") return `find "${a.query ?? ""}"`;
    if (a.action === "type") return `type ${(a.text ?? "").slice(0, 80)}`;
    if (a.action === "key") return `key ${a.key ?? ""}`;
    if (a.action === "scroll") return `scroll ${a.scroll_y ?? 0}`;
    if (a.x != null) return `${a.action} ${a.x},${a.y ?? "?"}`;
    return a.action ?? "screen";
  },
  permissionSubject: (a) => a.action || "screenshot",
  async execute(args, ctx) {
    const action = args.action;
    if (!ACTIONS.includes(action)) {
      return { output: `Unknown screen action "${String(action)}". Use one of: ${ACTIONS.join(", ")}.`, isError: true };
    }
    const provider = ctx.session.settings.provider;
    if (!supportsVision(provider) && action !== "read_screen" && action !== "find_text") {
      return {
        output: `Screen actions need a vision model, but ${provider.model} is text-only. Switch to a vision model (xAI Grok or DeepSeek Flash) in Settings → Model.`,
        isError: true,
      };
    }

    try {
      let where: { x: number; y: number; scaled: boolean } | undefined;

      // 1. Target by Element ID
      if (action === "click_element" || action === "type_into") {
        const id = finite(args.element_id, "element_id");
        const el = findElementById(id);
        if (!el) {
          return {
            output: `Element [${id}] not found in latest screen perception. Run action 'read_screen' first to get updated element IDs.`,
            isError: true,
          };
        }
        where = locate(el.centerX, el.centerY);
        await performAction({ dataDir: ctx.dataDir, kind: "click", x: where.x, y: where.y, button: "left", clicks: 1 });
        if (action === "type_into") {
          const text = String(args.text ?? "");
          if (text) {
            await settle();
            await performAction({ dataDir: ctx.dataDir, kind: "type", text });
          }
        }
        await settle();
      }

      // 2. Find text on screen
      else if (action === "find_text") {
        const query = String(args.query ?? "").trim().toLowerCase();
        if (!query) return { output: "find_text requires a query string.", isError: true };
        const shot = await captureScreen(ctx.dataDir, { withPerception: true });
        const matches = (shot.perception?.elements ?? []).filter(
          (e) => e.label.toLowerCase().includes(query) || (e.value && e.value.toLowerCase().includes(query)),
        );
        if (matches.length === 0) {
          return { output: `Text "${args.query}" was not found on screen. Active window: ${shot.perception?.app ?? "unknown"}.` };
        }
        const summary = matches
          .map((m) => `[${m.id}] ${m.role} "${m.label}" at (${m.centerX}, ${m.centerY})`)
          .join("\n");
        return { output: `Found ${matches.length} match(es) for "${args.query}":\n${summary}\n\nYou can click with 'click_element' element_id: ${matches[0]!.id}.` };
      }

      // 3. Wait for text to appear
      else if (action === "wait_for") {
        const query = String(args.query ?? "").trim().toLowerCase();
        if (!query) return { output: "wait_for requires a query string.", isError: true };
        const timeout = Math.min(30_000, Math.max(1_000, Number(args.timeout_ms) || 5_000));
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const shot = await captureScreen(ctx.dataDir, { withPerception: true });
          const found = (shot.perception?.elements ?? []).find(
            (e) => e.label.toLowerCase().includes(query) || (e.value && e.value.toLowerCase().includes(query)),
          );
          if (found) {
            return { output: `Found "${args.query}" on screen after ${Date.now() - start}ms: [${found.id}] ${found.role} "${found.label}" at (${found.centerX}, ${found.centerY}).` };
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        return { output: `Timed out after ${timeout}ms waiting for text "${args.query}" on screen.`, isError: true };
      }

      // 4. Zoom / Crop action
      else if (action === "zoom") {
        const x = finite(args.x, "x");
        const y = finite(args.y, "y");
        const w = Math.max(50, Math.min(1000, finite(args.width ?? 400, "width")));
        const h = Math.max(50, Math.min(800, finite(args.height ?? 300, "height")));
        const cropX = Math.max(0, Math.round(x - w / 2));
        const cropY = Math.max(0, Math.round(y - h / 2));
        const shot = await captureScreen(ctx.dataDir, { crop: { x: cropX, y: cropY, width: w, height: h } });
        const image = asImage(shot);
        const output = shotText("Zoom crop", shot);
        return {
          output,
          images: image ? [image] : undefined,
          display: image ? { kind: "image", url: image.url, prompt: "Zoom crop" } : { kind: "generic", text: output },
        };
      }

      // 5. Standard coordinates / input actions
      else if (action !== "screenshot" && action !== "read_screen") {
        if (action === "type") {
          const text = String(args.text ?? "");
          if (!text) return { output: "type needs text.", isError: true };
          if (text.length > MAX_TEXT) return { output: `text is limited to ${MAX_TEXT} characters.`, isError: true };
          await performAction({ dataDir: ctx.dataDir, kind: "type", text });
        } else if (action === "key") {
          const key = String(args.key ?? "").trim();
          if (!key) return { output: "key needs a key, such as enter or ctrl+l.", isError: true };
          await performAction({ dataDir: ctx.dataDir, kind: "key", key });
        } else if (action === "drag") {
          const from = optionalPoint(args, true);
          if (!from) return { output: "drag needs x and y.", isError: true };
          const to = locate(finite(args.to_x, "to_x"), finite(args.to_y, "to_y"));
          where = from;
          await performAction({ dataDir: ctx.dataDir, kind: "drag", x: from.x, y: from.y, toX: to.x, toY: to.y, button: "left" });
        } else if (action === "scroll") {
          const at = optionalPoint(args, false) ?? { x: 0, y: 0, scaled: false };
          const wheel = Math.max(-25, Math.min(25, Math.round(finite(args.scroll_y ?? -3, "scroll_y"))));
          where = at;
          await performAction({ dataDir: ctx.dataDir, kind: "scroll", x: at.x, y: at.y, wheel });
        } else {
          const at = optionalPoint(args, true);
          if (!at) return { output: `${action} needs x and y from the latest screenshot or element_id.`, isError: true };
          where = at;
          const button = action === "right_click" ? "right" : "left";
          const clicks = action === "double_click" ? 2 : 1;
          const kind = action === "move" ? "move" : "click";
          await performAction({ dataDir: ctx.dataDir, kind, x: at.x, y: at.y, button, clicks });
        }
        await settle();
      }

      // Finally capture screenshot with Set-of-Marks perception
      const shot = await captureScreen(ctx.dataDir, { withPerception: true });
      const image = asImage(shot);
      const label = action === "screenshot" || action === "read_screen" ? "Screen perception" : action.replaceAll("_", " ");
      const output = shotText(label, shot, where) + (image ? "" : "\nThe screenshot was too large to attach. Take another after closing large windows.");
      return {
        output,
        images: image ? [image] : undefined,
        display: image ? { kind: "image", url: image.url, prompt: label } : { kind: "generic", text: output },
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { output: message, isError: true };
    }
  },
};
