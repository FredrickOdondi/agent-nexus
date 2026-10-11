import { motion } from "motion/react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Section } from "../SettingsDialog";

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun; hint: string }[] = [
  { value: "light", label: "Light", icon: Sun, hint: "Warm paper, indigo accent" },
  { value: "dark", label: "Dark", icon: Moon, hint: "Neutral graphite, gray accent" },
  { value: "system", label: "System", icon: Monitor, hint: "Follow your OS setting" },
];

export function AppearanceTab() {
  const preference = useTheme((s) => s.preference);
  const setPreference = useTheme((s) => s.setPreference);
  return (
    <div>
      <Section title="Theme" description="Switches with a smooth reveal and is remembered per device.">
        <div className="grid gap-3 sm:grid-cols-3">
          {OPTIONS.map((o) => (
            <button key={o.value} type="button" onClick={(e) => setPreference(o.value, { x: e.clientX, y: e.clientY })} className={cn("group relative overflow-hidden rounded-2xl border p-3 text-left transition-colors hover:border-primary/50", preference === o.value && "border-primary ring-2 ring-primary/15")}>
              <Preview mode={o.value} />
              <span className="mt-3 flex items-center gap-2 text-sm font-medium"><o.icon className="size-4" />{o.label}{preference === o.value && <motion.span layoutId="theme-check" className="ml-auto text-primary"><Check className="size-4" /></motion.span>}</span>
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Motion" description="Animations respect your OS “reduce motion” preference automatically.">
        <p className="text-sm text-muted-foreground">Message entrances, tool cards, theme transitions and list reordering use spring physics tuned for a calm, responsive feel.</p>
      </Section>
    </div>
  );
}

function Preview({ mode }: { mode: ThemePreference }) {
  const dark = mode === "dark";
  const system = mode === "system";
  return (
    <div className={cn("relative h-24 overflow-hidden rounded-xl border", dark ? "bg-[oklch(0.16_0_0)]" : "bg-[oklch(0.985_0.003_85)]")}>
      {system && <div className="absolute inset-y-0 right-0 w-1/2 bg-[oklch(0.16_0_0)]" />}
      <div className="absolute inset-y-0 left-0 w-1/3 border-r border-black/5 bg-black/[0.03] dark:border-white/5" />
      <div className={cn("absolute top-3 right-3 h-5 w-24 rounded-full", dark || system ? "bg-[oklch(0.34_0_0)]" : "bg-[oklch(0.56_0.2_268)]")} />
      <div className={cn("absolute top-10 left-[38%] h-2 w-28 rounded-full", dark ? "bg-white/40" : "bg-black/20")} />
      <div className={cn("absolute top-14 left-[38%] h-2 w-20 rounded-full", dark ? "bg-white/25" : "bg-black/10")} />
      <div className={cn("absolute right-3 bottom-3 left-[38%] h-6 rounded-full border", dark ? "border-white/10 bg-white/5" : "border-black/10 bg-white")} />
    </div>
  );
}
