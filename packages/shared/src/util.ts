import type { Message, Part } from "./types.js";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Compact, URL-safe, time-sortable id (works in browsers and Node). */
export function newId(prefix = ""): string {
  const time = Date.now().toString(36);
  let rand = "";
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) rand += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${time}${rand}` : `${time}${rand}`;
}

export function messageText(message: Pick<Message, "parts">): string {
  return message.parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

export function truncate(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export function deriveTitle(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "New chat";
  return truncate(firstLine.replace(/^[#>*\-\s]+/, ""), 48) || "New chat";
}

export function formatRelative(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
