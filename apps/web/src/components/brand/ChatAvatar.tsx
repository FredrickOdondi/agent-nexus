import { NimbusMark, type MarkPalette } from "./NimbusMark";
import { cn } from "@/lib/utils";

export interface Colorway {
  id: string;
  name: string;
  palette: MarkPalette;
  bg: string;
}

/** Curated mascot colorways: [gradient start, mid, end, avatar backdrop]. */
export const COLORWAYS: readonly Colorway[] = [
  { id: "indigo", name: "Nimbus Indigo", palette: ["#8d7cff", "#6d5ef8", "#3ecfbf"], bg: "rgba(109, 94, 248, 0.14)" },
  { id: "sunset", name: "Sunset", palette: ["#ffb38a", "#ff7a59", "#ff4f8b"], bg: "rgba(255, 122, 89, 0.16)" },
  { id: "mint", name: "Mint", palette: ["#7ee8c7", "#22c39a", "#0f9fb8"], bg: "rgba(34, 195, 154, 0.15)" },
  { id: "sunshine", name: "Sunshine", palette: ["#ffe08a", "#ffc23d", "#ff8f3d"], bg: "rgba(255, 194, 61, 0.18)" },
  { id: "bubblegum", name: "Bubblegum", palette: ["#ff9ad5", "#e85dc0", "#9b5cf6"], bg: "rgba(232, 93, 192, 0.15)" },
  { id: "sky", name: "Sky", palette: ["#8fd3ff", "#3b9dff", "#4f5dff"], bg: "rgba(59, 157, 255, 0.15)" },
  { id: "lime", name: "Lime", palette: ["#c3f584", "#7fd34e", "#2fb67c"], bg: "rgba(127, 211, 78, 0.16)" },
  { id: "cherry", name: "Cherry", palette: ["#ff9b9b", "#f2545b", "#c2367a"], bg: "rgba(242, 84, 91, 0.14)" },
  { id: "lavender", name: "Lavender", palette: ["#b9a6ff", "#8b6cf0", "#5b3fd6"], bg: "rgba(139, 108, 240, 0.15)" },
  { id: "lagoon", name: "Lagoon", palette: ["#9ff0f0", "#3fd0e0", "#2a8cd6"], bg: "rgba(63, 208, 224, 0.15)" },
];

/** Stable string hash (FNV-1a), so a subagent keeps its color across reloads and devices. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function colorwayFor(seed?: string): Colorway {
  if (!seed) return COLORWAYS[0];
  const matched = COLORWAYS.find((c) => c.id.toLowerCase() === seed.toLowerCase());
  if (matched) return matched;
  return COLORWAYS[hash(seed) % COLORWAYS.length];
}

/** Subagent display picture: the Nimbus mascot in a curated colorway. */
export function SubagentAvatar({
  seed,
  avatar,
  size = 28,
  live = false,
  className,
}: {
  seed: string;
  avatar?: string;
  size?: number;
  live?: boolean;
  className?: string;
}) {
  const { palette, bg } = colorwayFor(avatar || seed);
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-xl shadow-xs ring-1 ring-black/5 dark:ring-white/10 select-none",
        className
      )}
      style={{ width: size, height: size, background: bg }}
    >
      <NimbusMark size={Math.round(size * 0.78)} state={live ? "loading" : "static"} palette={palette} />
    </span>
  );
}

/** Legacy alias for SubagentAvatar */
export const ChatAvatar = SubagentAvatar;
