import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "system";

const KEY = "nimbus.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function resolve(pref: ThemePreference): "light" | "dark" {
  return pref === "system" ? (media.matches ? "dark" : "light") : pref;
}

function apply(resolved: "light" | "dark") {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#1a1b23" : "#fbfaf8");
}

interface ThemeState {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference(pref: ThemePreference, origin?: { x: number; y: number }): void;
  toggle(origin?: { x: number; y: number }): void;
}

const initial = ((localStorage.getItem(KEY) as ThemePreference | null) ?? "system");
apply(resolve(initial));

export const useTheme = create<ThemeState>((set, get) => ({
  preference: initial,
  resolved: resolve(initial),
  setPreference(pref, origin) {
    localStorage.setItem(KEY, pref);
    const next = resolve(pref);
    const run = () => {
      apply(next);
      set({ preference: pref, resolved: next });
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (doc.startViewTransition && !reduce && next !== get().resolved) {
      if (origin) {
        document.documentElement.style.setProperty("--theme-x", `${origin.x}px`);
        document.documentElement.style.setProperty("--theme-y", `${origin.y}px`);
      }
      doc.startViewTransition(run);
    } else run();
  },
  toggle(origin) {
    get().setPreference(get().resolved === "dark" ? "light" : "dark", origin);
  },
}));

media.addEventListener("change", () => {
  const { preference } = useTheme.getState();
  if (preference === "system") {
    const next = resolve("system");
    apply(next);
    useTheme.setState({ resolved: next });
  }
});
