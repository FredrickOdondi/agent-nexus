import { useEffect, useState } from "react";
import { Bot, Cpu, Info, Palette, Plug, Smartphone } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AboutTab } from "./tabs/AboutTab";
import { AgentTab } from "./tabs/AgentTab";
import { AppsTab } from "./tabs/AppsTab";
import { AppearanceTab } from "./tabs/AppearanceTab";
import { DevicesTab } from "./tabs/DevicesTab";
import { ModelTab } from "./tabs/ModelTab";

const TABS = [
  { id: "model", label: "Model", icon: Cpu },
  { id: "agent", label: "Agent & tools", icon: Bot },
  { id: "apps", label: "Apps", icon: Plug },
  { id: "devices", label: "Devices", icon: Smartphone },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "about", label: "About", icon: Info },
];

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const tab = useStore((s) => s.settingsTab);
  const close = useStore((s) => s.closeSettings);
  const openSettings = useStore((s) => s.openSettings);
  const [mobileList, setMobileList] = useState(true);
  useEffect(() => { if (open) setMobileList(true); }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="flex h-[min(680px,92dvh)] w-[min(880px,96vw)] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-none sm:flex-row" showCloseButton>
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your model, connected apps, agent tools, linked devices and appearance.</DialogDescription>
        </DialogHeader>
        <nav className={cn("shrink-0 border-b bg-sidebar p-2 sm:w-52 sm:border-r sm:border-b-0 sm:p-3", !mobileList && "hidden sm:block")} aria-label="Settings sections">
          <p className="hidden px-2 pt-1 pb-2 text-sm font-semibold sm:block">Settings</p>
          <ul className="flex gap-1 overflow-x-auto hide-scrollbar sm:flex-col">
            {TABS.map((t) => (
              <li key={t.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => { openSettings(t.id); setMobileList(false); }}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm whitespace-nowrap transition-colors", tab === t.id ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground")}
                >
                  <t.icon className="size-4" />{t.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {tab === "model" && <ModelTab />}
          {tab === "agent" && <AgentTab />}
          {tab === "apps" && <AppsTab />}
          {tab === "devices" && <DevicesTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "about" && <AboutTab />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {description && <p className="mt-0.5 mb-3 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

export function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cn("flex cursor-pointer items-start justify-between gap-4 rounded-xl border bg-surface px-3.5 py-3 transition-colors hover:bg-muted/40", disabled && "opacity-60")}>
      <span><span className="block text-sm font-medium">{label}</span>{hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}</span>
      <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={cn("relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50", checked ? "bg-primary" : "bg-input")}>
        <span className={cn("absolute size-4 rounded-full bg-background elevation-1 transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
      </span>
    </label>
  );
}

export const selectClass = "h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
