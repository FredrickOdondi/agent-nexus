import type { ToolDefinition } from "../types.js";
import { captureScreen, currentFrame, locate, performAction, settle, type Shot } from "./screen.js";

const ACTIONS = ["screenshot", "click", "double_click", "right_click", "move", "scroll", "type", "key", "drag"] as const;
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
}

const MAX_TEXT = 4_000;
const MAX_IMAGE_BYTES = 1_400_000;

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

function shotText(action: string, shot: Shot, where?: { x: number; y: number; scaled: boolean }): string {
  const lines: string[] = [];
  if (where) lines.push(`${action} at screen pixel ${where.x},${where.y}${where.scaled ? "" : " (no earlier screenshot, so this was used as a screen pixel)"}.`);
  else lines.push(`${action}.`);
  lines.push(`Screenshot is ${shot.imageWidth}×${shot.imageHeight} pixels. The screen is ${shot.screenWidth}×${shot.screenHeight}, origin ${shot.originX},${shot.originY}.`);
  lines.push("The image is attached. The next computer coordinates are pixels of that image, origin at the top-left.");
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
    "See and click the computer this agent is running on. Always start with action screenshot, look at the image, then act.",
    "Coordinates are pixels of the latest screenshot, origin at the top-left. A new screenshot is returned after every action.",
    "Actions: screenshot, click, double_click, right_click, move, drag (x, y, to_x, to_y), scroll (x, y, scroll_y; positive is down), type (text), key (enter, tab, escape, backspace, arrows, or a chord like ctrl+l or cmd+c).",
    "Only use this when the user asked you to operate the screen. Ask before sending, deleting, paying, or granting a permission.",
    "Clicks happen on the machine running Nimbus, not on a linked phone. If this fails, tell the user the exact error.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: [...ACTIONS], description: "What to do on the screen." },
      x: { type: "number", description: "Horizontal pixel in the latest screenshot." },
      y: { type: "number", description: "Vertical pixel in the latest screenshot." },
      to_x: { type: "number", description: "Drag destination x, in screenshot pixels." },
      to_y: { type: "number", description: "Drag destination y, in screenshot pixels." },
      text: { type: "string", description: "Text to type. Used by action type." },
      key: { type: "string", description: "Key or chord, such as enter, tab, escape, ctrl+l, cmd+c." },
      scroll_y: { type: "number", description: "Wheel notches. Positive scrolls down. Used by action scroll." },
    },
    required: ["action"],
  },
  permission: "Computer",
  readOnly: false,
  summarize: (a) => {
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
    try {
      let where: { x: number; y: number; scaled: boolean } | undefined;
      if (action !== "screenshot") {
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
          if (!at) return { output: `${action} needs x and y from the latest screenshot.`, isError: true };
          where = at;
          const button = action === "right_click" ? "right" : "left";
          const clicks = action === "double_click" ? 2 : 1;
          const kind = action === "move" ? "move" : "click";
          await performAction({ dataDir: ctx.dataDir, kind, x: at.x, y: at.y, button, clicks });
        }
        await settle();
      }
      const shot = await captureScreen(ctx.dataDir);
      const image = asImage(shot);
      const label = action === "screenshot" ? "Screenshot" : action.replaceAll("_", " ");
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
