/**
 * Screen perception: merges Accessibility (AX) UI elements and local OCR into a unified,
 * numbered list of interactive targets (Set-of-Marks) that the agent can read and click.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { run, commandExists } from "./screen-proc.js";
import { see } from "./screen-see.js";
import type { ScreenFrame } from "./screen-geom.js";

export interface OcrEntry {
  text: string;
  confidence: number;
  /** Normalized coordinates [0..1] relative to the image. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AxElement {
  role: string;
  subrole?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  enabled: boolean;
  focused: boolean;
  /** Screen points. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AxDump {
  app: string;
  bundle?: string;
  window?: string;
  pid: number;
  elements: AxElement[];
}

export interface ScreenElement {
  id: number;
  kind: "ax" | "ocr";
  role: string;
  label: string;
  value?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  centerX: number;
  centerY: number;
}

export interface PerceptionResult {
  app?: string;
  window?: string;
  elements: ScreenElement[];
  rawText: string;
}

/** Runs OCR on an image file. Returns normalized bounding boxes [0..1]. */
export async function runOcr(imageFile: string, dataDir: string): Promise<OcrEntry[]> {
  if (process.platform === "darwin") {
    try {
      const out = await see(dataDir, ["ocr", imageFile]);
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Fallback if see helper fails
    }
  }

  // Linux / fallback: tesseract with TSV output if available
  if (await commandExists("tesseract")) {
    try {
      const { stdout } = await run("tesseract", [imageFile, "stdout", "-l", "eng", "--psm", "11", "tsv"]);
      return parseTesseractTsv(stdout);
    } catch {
      // Ignore
    }
  }

  return [];
}

function parseTesseractTsv(tsv: string): OcrEntry[] {
  const lines = tsv.trim().split("\n");
  const entries: OcrEntry[] = [];
  if (lines.length <= 1) return entries;
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i]!.split("\t");
    if (parts.length < 12) continue;
    const conf = Number(parts[10]);
    const text = (parts[11] ?? "").trim();
    if (conf > 30 && text) {
      entries.push({
        text,
        confidence: conf / 100,
        x: Number(parts[6]),
        y: Number(parts[7]),
        w: Number(parts[8]),
        h: Number(parts[9]),
      });
    }
  }
  return entries;
}

/** Fetches frontmost app's Accessibility tree. */
export async function getAxElements(dataDir: string): Promise<AxDump | null> {
  if (process.platform === "darwin") {
    try {
      const out = await see(dataDir, ["ax"]);
      return JSON.parse(out) as AxDump;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Combines AX elements and OCR words into a deduplicated, ranked list of targets.
 * Elements are mapped to coordinates matching the screenshot image that the agent sees.
 */
export function buildPerception(
  axDump: AxDump | null,
  ocrList: OcrEntry[],
  frame: ScreenFrame,
): PerceptionResult {
  const elements: ScreenElement[] = [];
  let nextId = 1;

  const sx = frame.screenWidth > 0 ? frame.imageWidth / frame.screenWidth : 1;
  const sy = frame.screenHeight > 0 ? frame.imageHeight / frame.screenHeight : 1;

  // 1. Ingest AX elements
  if (axDump && Array.isArray(axDump.elements)) {
    for (const el of axDump.elements) {
      const imgX = Math.round((el.x - frame.originX) * sx);
      const imgY = Math.round((el.y - frame.originY) * sy);
      const imgW = Math.round(el.w * sx);
      const imgH = Math.round(el.h * sy);

      // Skip elements that are offscreen or 0-sized
      if (imgX + imgW <= 0 || imgY + imgH <= 0 || imgX >= frame.imageWidth || imgY >= frame.imageHeight) continue;
      if (imgW < 4 || imgH < 4) continue;

      const roleClean = el.role.replace(/^AX/, "").toLowerCase();
      const label = (el.label || el.placeholder || el.value || "").trim();
      if (!label && roleClean === "statictext") continue;

      elements.push({
        id: nextId++,
        kind: "ax",
        role: roleClean,
        label: label || `(${roleClean})`,
        value: el.value && el.value !== label ? el.value : undefined,
        x: Math.max(0, imgX),
        y: Math.max(0, imgY),
        w: imgW,
        h: imgH,
        centerX: Math.round(imgX + imgW / 2),
        centerY: Math.round(imgY + imgH / 2),
      });
    }
  }

  // 2. Ingest OCR text that is not already covered by an AX label
  const rawLines: string[] = [];
  for (const o of ocrList) {
    rawLines.push(o.text);
    // Convert normalized [0..1] to screenshot image pixels
    const imgX = Math.round(o.x * frame.imageWidth);
    const imgY = Math.round(o.y * frame.imageHeight);
    const imgW = Math.round(o.w * frame.imageWidth);
    const imgH = Math.round(o.h * frame.imageHeight);

    const cx = Math.round(imgX + imgW / 2);
    const cy = Math.round(imgY + imgH / 2);

    // Check overlap with existing AX element
    const overlaps = elements.some((e) => {
      return (
        cx >= e.x - 5 &&
        cx <= e.x + e.w + 5 &&
        cy >= e.y - 5 &&
        cy <= e.y + e.h + 5
      );
    });

    if (!overlaps && o.text.trim().length > 1) {
      elements.push({
        id: nextId++,
        kind: "ocr",
        role: "text",
        label: o.text.trim(),
        x: imgX,
        y: imgY,
        w: imgW,
        h: imgH,
        centerX: cx,
        centerY: cy,
      });
    }
  }

  return {
    app: axDump?.app,
    window: axDump?.window,
    elements,
    rawText: rawLines.join(" "),
  };
}

/**
 * Creates a marks text file for the `nimbus-see render` command.
 * Format per line: `<id> <x> <y> <w> <h>`
 */
export async function writeMarksFile(elements: ScreenElement[]): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nimbus-marks-"));
  const marksPath = path.join(dir, "marks.txt");
  const lines = elements.map((e) => `${e.id} ${e.x} ${e.y} ${e.w} ${e.h}`);
  await fs.writeFile(marksPath, lines.join("\n"), "utf8");
  return marksPath;
}

/** Formats the elements list into a clean, LLM-digestible text summary. */
export function formatElementsForPrompt(p: PerceptionResult, maxCount = 120): string {
  const header: string[] = [];
  if (p.app || p.window) {
    header.push(`Active window: ${p.app ?? "Unknown"}${p.window ? ` — "${p.window}"` : ""}`);
  }
  header.push(`Interactive UI elements & text on screen (use action "click_element" with the element ID):`);

  const list = p.elements.slice(0, maxCount).map((e) => {
    const val = e.value ? ` val="${e.value.slice(0, 40)}"` : "";
    return `[${e.id}] ${e.role} "${e.label}"${val} at (${e.centerX}, ${e.centerY})`;
  });

  if (p.elements.length > maxCount) {
    list.push(`... and ${p.elements.length - maxCount} more elements.`);
  }

  return [...header, ...list].join("\n");
}
