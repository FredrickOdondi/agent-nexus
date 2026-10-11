import { AnimatePresence, motion } from "motion/react";
import { Menu, PanelLeftClose, PanelLeftOpen, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConversation, useStore } from "@/lib/store";
import { isElectron, isMac } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";

export function Header({ mobile }: { mobile: boolean }) {
  const selectedId = useStore((s) => s.selectedId);
  const conversation = useConversation(selectedId);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebar = useStore((s) => s.setSidebar);
  const connection = useStore((s) => s.connection);
  const settings = useStore((s) => s.settings);
  const run = useStore((s) => (selectedId ? s.runs[selectedId] : undefined));

  const title = conversation?.title ?? "New chat";
  const mode = conversation?.mode ?? useStore.getState().draftMode;

  return (
    <header className={cn("relative z-10 flex h-12 shrink-0 items-center gap-1 border-b bg-background/80 px-2 glass sm:px-3", isElectron && isMac && !sidebarOpen && "drag-region pl-20")}>
      <div className="no-drag flex items-center">
        {mobile ? (
          <Button variant="ghost" size="icon-sm" onClick={() => setSidebar(true)} aria-label="Open menu"><Menu /></Button>
        ) : (
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => setSidebar(!sidebarOpen)} aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} />}>{sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</TooltipTrigger>
            <TooltipContent>{sidebarOpen ? "Hide sidebar" : "Show sidebar"}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.h2 key={title} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="truncate text-sm font-medium">
            {title}
          </motion.h2>
        </AnimatePresence>
        <Badge variant="outline" className="hidden h-5 shrink-0 px-1.5 text-[10px] font-medium capitalize sm:inline-flex">{mode}</Badge>
        {run && run.state !== "idle" && <span className="hidden size-1.5 shrink-0 rounded-full bg-primary animate-pulse sm:inline-block" />}
      </div>
      <div className="no-drag flex items-center gap-1">
        {connection !== "online" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-1 text-[11px] font-medium text-destructive"><WifiOff className="size-3" />{connection === "connecting" ? "Connecting" : "Offline"}</span>
        )}
        {settings && <Badge variant="secondary" className="hidden h-6 max-w-40 truncate px-2 font-mono text-[11px] md:inline-flex" title={settings.provider.model}>{settings.provider.kind === "mock" || !settings.provider.hasApiKey ? "demo" : settings.provider.model}</Badge>}
        {mobile && <ThemeToggle />}
      </div>
    </header>
  );
}
