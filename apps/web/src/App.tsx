import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Toaster } from "@/components/ui/sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/layout/Header";
import { InstallHint } from "@/components/layout/InstallHint";
import { Sidebar } from "@/components/layout/Sidebar";
import { Thread } from "@/components/chat/Thread";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { LinkDevice } from "@/components/onboarding/LinkDevice";
import { TOKEN_KEY, useStore } from "@/lib/store";
import { isElectron, isMac, isStandalonePwa } from "@/lib/platform";
import { cn } from "@/lib/utils";

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

/** `#/pair/123456` deep links come from the QR code shown on the desktop. */
function readPairCode(): string | undefined {
  const m = /^#\/pair\/(\d{6})/.exec(location.hash);
  return m?.[1];
}

export default function App() {
  const [linked, setLinked] = useState(() => Boolean(localStorage.getItem(TOKEN_KEY)));
  const [pairCode, setPairCode] = useState(readPairCode);
  const init = useStore((s) => s.init);

  useEffect(() => {
    const onHash = () => setPairCode(readPairCode());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (linked) void init();
  }, [linked, init]);

  // A fresh QR scan while already linked re-links as a new device.
  const showLink = !linked || Boolean(pairCode);

  return (
    <TooltipProvider delay={300}>
      <AnimatePresence mode="wait" initial={false}>
        {showLink ? (
          <motion.div key="link" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.985 }} transition={{ duration: 0.25 }}>
            <LinkDevice
              initialCode={pairCode}
              onLinked={() => {
                if (location.hash.startsWith("#/pair/")) history.replaceState(null, "", location.pathname);
                setPairCode(undefined);
                setLinked(true);
              }}
            />
          </motion.div>
        ) : (
          <motion.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
            <Shell />
          </motion.div>
        )}
      </AnimatePresence>
      <Toaster position="top-center" richColors closeButton />
    </TooltipProvider>
  );
}

function Shell() {
  const isDesktopLayout = useMediaQuery("(min-width: 1024px)");
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const setSidebar = useStore((s) => s.setSidebar);

  // Reset the drawer when crossing the desktop/mobile breakpoint so the
  // desktop's "sidebar open" state never pops the mobile sheet open.
  useEffect(() => {
    setSidebar(isDesktopLayout);
  }, [isDesktopLayout, setSidebar]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); useStore.getState().newChat(); }
      if (e.key === "," ) { e.preventDefault(); useStore.getState().openSettings(); }
      if (e.key === "b" || e.key === "B") { e.preventDefault(); setSidebar(!useStore.getState().sidebarOpen); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSidebar]);

  return (
    <div className={cn("flex h-dvh w-full overflow-hidden bg-background text-foreground", isElectron && "rounded-none", isStandalonePwa && "safe-top")}>
      {isDesktopLayout ? (
        <motion.div
          initial={false}
          animate={{ width: sidebarOpen ? 288 : 0, opacity: sidebarOpen ? 1 : 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 34 }}
          className="relative h-full shrink-0 overflow-hidden border-r border-sidebar-border"
          aria-hidden={!sidebarOpen}
        >
          <div className="h-full w-72"><Sidebar /></div>
        </motion.div>
      ) : (
        <Sheet open={sidebarOpen} onOpenChange={setSidebar}>
          <SheetContent side="left" showCloseButton={false} className="w-[86vw] max-w-sm gap-0 p-0 sm:max-w-sm">
            <SheetHeader className="sr-only">
              <SheetTitle>Conversations</SheetTitle>
              <SheetDescription>Browse your chats and settings</SheetDescription>
            </SheetHeader>
            <Sidebar onNavigate={() => setSidebar(false)} />
          </SheetContent>
        </Sheet>
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <Header mobile={!isDesktopLayout} />
        {!isDesktopLayout && <InstallHint />}
        <Thread />
      </main>
      <SettingsDialog />
    </div>
  );
}
