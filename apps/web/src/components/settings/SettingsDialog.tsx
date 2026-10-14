import { useEffect, useState } from "react";
import { Bot, ChevronLeft, ChevronRight, Cpu, Info, Palette, Plug, Smartphone, Sparkles, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AboutTab } from "./tabs/AboutTab";
import { AccountTab } from "./tabs/AccountTab";
import { AgentTab } from "./tabs/AgentTab";
import { AppsTab } from "./tabs/AppsTab";
import { AppearanceTab } from "./tabs/AppearanceTab";
import { DevicesTab } from "./tabs/DevicesTab";
import { ModelTab } from "./tabs/ModelTab";
import { SubscriptionTab } from "./tabs/SubscriptionTab";

const TABS = [
  { id: "account", label: "Account", icon: UserRound },
  { id: "subscription", label: "Plan & Billing", icon: Sparkles },
  { id: "model", label: "Model", icon: Cpu },
  { id: "agent", label: "Agent & tools", icon: Bot },
  { id: "apps", label: "Apps", icon: Plug },
  { id: "devices", label: "Devices", icon: Smartphone },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "about", label: "About", icon: Info },
];

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", handler);
    setMatches(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

function SettingsPanel({ tab }: { tab: string }) {
  return (
    <>
      {tab === "account" && <AccountTab />}
      {tab === "subscription" && <SubscriptionTab />}
      {tab === "model" && <ModelTab />}
      {tab === "agent" && <AgentTab />}
      {tab === "apps" && <AppsTab />}
      {tab === "devices" && <DevicesTab />}
      {tab === "appearance" && <AppearanceTab />}
      {tab === "about" && <AboutTab />}
    </>
  );
}

export function SettingsDialog() {
  const open = useStore((s) => s.settingsOpen);
  const tab = useStore((s) => s.settingsTab);
  const atRoot = useStore((s) => s.settingsAtRoot);
  const close = useStore((s) => s.closeSettings);
  const openSettings = useStore((s) => s.openSettings);
  const showRoot = useStore((s) => s.showSettingsRoot);
  const subscription = useStore((s) => s.subscription);
  const phone = useMediaQuery("(max-width: 1023px)");
  const current = TABS.find((t) => t.id === tab);

  const isPro = subscription?.tier === "pro";
  const isTrial = subscription?.status === "trialing";
  const isLifetime = Boolean(
    subscription?.billingInterval === "lifetime" ||
    subscription?.planName?.toLowerCase().includes("lifetime") ||
    subscription?.licenseKey?.toUpperCase().includes("LIFE")
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        fullscreen={phone}
        showCloseButton={!phone || atRoot}
        className={phone ? "bg-background" : "flex h-[min(680px,92dvh)] w-[min(880px,96vw)] max-w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-none sm:flex-row"}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your model, connected apps, agent tools, linked devices and appearance.</DialogDescription>
        </DialogHeader>
        {phone ? (
          atRoot ? (
            <div className="flex h-full min-h-0 flex-col">
              <header className="px-5 pt-[max(1.25rem,env(safe-area-inset-top))] pr-16 pb-2">
                <h2 className="text-[32px] leading-none font-semibold tracking-tight">Settings</h2>
              </header>
              <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))]" aria-label="Settings sections">
                {TABS.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => openSettings(t.id)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left active:bg-muted">
                      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-foreground"><t.icon className="size-5" /></span>
                      <span className="text-[17px] font-medium">{t.label}</span>
                      {t.id === "subscription" && (
                        <span className={cn(
                          "ml-auto rounded-full px-2 py-0.5 text-xs font-bold uppercase",
                          isLifetime
                            ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                            : isPro
                            ? isTrial ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" : "bg-primary/20 text-primary"
                            : "bg-muted text-muted-foreground"
                        )}>
                          {isLifetime ? "Lifetime" : isPro ? (isTrial ? "Trial" : "Pro") : "Free"}
                        </span>
                      )}
                      <ChevronRight className={cn("size-4 text-muted-foreground", t.id !== "subscription" && "ml-auto")} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <header className="relative flex items-center border-b pt-[env(safe-area-inset-top)]">
                <button type="button" onClick={showRoot} className="flex h-12 items-center gap-0.5 px-1 text-[17px] text-primary active:opacity-60">
                  <ChevronLeft className="size-6" />
                  Settings
                </button>
                <p className="pointer-events-none absolute inset-x-24 truncate text-center text-[17px] font-semibold">{current?.label}</p>
                <button type="button" onClick={close} className="ml-auto flex h-12 items-center px-4 text-[17px] text-primary active:opacity-60">Done</button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                <SettingsPanel tab={tab} />
              </div>
            </div>
          )
        ) : (
          <>
            <nav className="shrink-0 border-b bg-sidebar p-2 sm:w-52 sm:border-r sm:border-b-0 sm:p-3" aria-label="Settings sections">
              <p className="hidden px-2 pt-1 pb-2 text-sm font-semibold sm:block">Settings</p>
              <ul className="flex gap-1 overflow-x-auto hide-scrollbar sm:flex-col">
                {TABS.map((t) => (
                  <li key={t.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => openSettings(t.id)}
                      className={cn("flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm whitespace-nowrap transition-colors", tab === t.id ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground")}
                    >
                      <t.icon className="size-4" />
                      <span>{t.label}</span>
                      {t.id === "subscription" && (
                        <span className={cn(
                          "ml-auto rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider",
                          isLifetime
                            ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 font-extrabold"
                            : isPro
                            ? isTrial ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" : "bg-primary/20 text-primary"
                            : "bg-muted-foreground/15 text-muted-foreground"
                        )}>
                          {isLifetime ? "Lifetime" : isPro ? (isTrial ? "Trial" : "Pro") : "Free"}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <SettingsPanel tab={tab} />
            </div>
          </>
        )}
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
