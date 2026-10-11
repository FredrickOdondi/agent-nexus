import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/layout/Header";
import { MobileShell } from "@/components/layout/MobileShell";
import { Sidebar } from "@/components/layout/Sidebar";
import { Thread } from "@/components/chat/Thread";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { LinkDevice } from "@/components/onboarding/LinkDevice";
import { SignIn } from "@/components/onboarding/SignIn";
import { useAuth } from "@/lib/auth";
import { TOKEN_KEY, useStore } from "@/lib/store";
import { supabaseAccessToken } from "@/lib/supabase";
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
  const { ready, session } = useAuth();
  const [linked, setLinked] = useState(() => Boolean(localStorage.getItem(TOKEN_KEY)));
  const [pairCode, setPairCode] = useState(readPairCode);
  const [accountGate, setAccountGate] = useState<"checking" | "ok" | "mismatch">(() => (localStorage.getItem(TOKEN_KEY) ? "checking" : "ok"));
  const [mismatch, setMismatch] = useState<string | null>(null);
  const init = useStore((s) => s.init);
  const signOut = useStore((s) => s.signOut);

  useEffect(() => {
    const onHash = () => setPairCode(readPairCode());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!session || !localStorage.getItem(TOKEN_KEY)) {
      setAccountGate("ok");
      return;
    }
    let cancelled = false;
    setAccountGate("checking");
    (async () => {
      try {
        const access = await supabaseAccessToken();
        const res = await fetch("/api/account/claim", {
          method: "POST",
          headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ""}`, "x-supabase-token": access },
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (cancelled) return;
        if (res.status === 403) {
          setMismatch(body.error || "This Nimbus belongs to a different Google account.");
          setAccountGate("mismatch");
          return;
        }
        setAccountGate("ok");
      } catch {
        if (!cancelled) setAccountGate("ok");
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    if (linked && accountGate === "ok") void init();
  }, [linked, accountGate, init]);

  // A fresh QR scan while already linked re-links as a new device.
  const showLink = !linked || Boolean(pairCode);

  let screen: "loading" | "signin" | "mismatch" | "link" | "app" = "app";
  if (!ready || (session && linked && accountGate === "checking" && !pairCode)) screen = "loading";
  else if (!session) screen = "signin";
  else if (accountGate === "mismatch" && !pairCode) screen = "mismatch";
  else if (showLink) screen = "link";

  return (
    <TooltipProvider delay={300}>
      <AnimatePresence mode="wait" initial={false}>
        {screen === "loading" ? (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
            Checking your account…
          </motion.div>
        ) : screen === "signin" ? (
          <motion.div key="signin" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.985 }} transition={{ duration: 0.25 }}>
            <SignIn />
          </motion.div>
        ) : screen === "mismatch" ? (
          <motion.div key="mismatch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center">
            <h1 className="text-xl font-semibold tracking-tight">Different Google account</h1>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{mismatch}</p>
            <button type="button" onClick={() => void signOut()} className="mt-6 h-12 rounded-xl bg-primary px-5 text-base font-medium text-primary-foreground">Sign out</button>
          </motion.div>
        ) : screen === "link" ? (
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

  if (!isDesktopLayout) {
    return (
      <>
        <MobileShell />
        <SettingsDialog />
      </>
    );
  }

  return (
    <div className={cn("flex h-dvh w-full overflow-hidden bg-background text-foreground", isElectron && "rounded-none", isStandalonePwa && "safe-top")}>
      <motion.div
        initial={false}
        animate={{ width: sidebarOpen ? 288 : 0, opacity: sidebarOpen ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="relative h-full shrink-0 overflow-hidden border-r border-sidebar-border"
        aria-hidden={!sidebarOpen}
      >
        <div className="h-full w-72"><Sidebar /></div>
      </motion.div>

      <main className="relative flex min-w-0 flex-1 flex-col">
        <Header mobile={false} />
        <Thread />
      </main>
      <SettingsDialog />
    </div>
  );
}
