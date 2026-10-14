import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Header } from "@/components/layout/Header";
import { MobileShell } from "@/components/layout/MobileShell";
import { Sidebar } from "@/components/layout/Sidebar";
import { Thread } from "@/components/chat/Thread";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { UpgradeModal } from "@/components/settings/UpgradeModal";
import { LinkDevice } from "@/components/onboarding/LinkDevice";
import { NimbusLoader } from "@/components/brand/NimbusMark";
import { SignIn } from "@/components/onboarding/SignIn";
import { forgetTokenForUser, migratableToken, prepareCache, saveTokenForUser, tokenForUser, TOKEN_KEY } from "@/lib/account";
import { clearCache } from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
import { supabaseAccessToken } from "@/lib/supabase";
import { isElectron, isMac, isStandalonePwa } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { LandingPage } from "@/components/landing/LandingPage";

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
  const userId = session?.user.id ?? null;
  const [linked, setLinked] = useState(false);
  const [pairCode, setPairCode] = useState(readPairCode);
  const [accountGate, setAccountGate] = useState<"checking" | "ready" | "error">("checking");
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountTry, setAccountTry] = useState(0);
  const init = useStore((s) => s.init);
  const signOut = useStore((s) => s.signOut);

  const [showLanding, setShowLanding] = useState(() => {
    if (isElectron) return false;
    const h = typeof window !== "undefined" ? window.location.hash : "";
    if (h.startsWith("#/pair/") || h.startsWith("#/app") || h.startsWith("#/signin")) return false;
    return true;
  });

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash;
      setPairCode(readPairCode());
      if (h.startsWith("#/pair/") || h.startsWith("#/app") || h.startsWith("#/signin")) {
        setShowLanding(false);
      } else if (h.startsWith("#/download") || h.startsWith("#/landing") || h === "" || h === "#" || h === "#/") {
        if (!isElectron && !session) {
          setShowLanding(true);
        }
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [session]);

  useEffect(() => {
    if (!userId) {
      setLinked(false);
      setAccountGate(ready ? "ready" : "checking");
      return;
    }
    let cancelled = false;
    setLinked(false);
    setAccountGate("checking");
    setAccountError(null);
    useStore.getState().resetLocal();
    (async () => {
      await prepareCache(userId);
      let token = tokenForUser(userId);
      const legacy = token ? null : migratableToken(userId);
      const candidate = token ?? legacy;
      if (candidate) {
        try {
          const access = await supabaseAccessToken();
          const res = await fetch("/api/account/claim", {
            method: "POST",
            headers: { Authorization: `Bearer ${candidate}`, "x-supabase-token": access },
          });
          if (cancelled) return;
          if (res.ok) {
            saveTokenForUser(userId, candidate);
            token = candidate;
          } else if (res.status === 401 || res.status === 403) {
            forgetTokenForUser(userId);
            localStorage.removeItem(TOKEN_KEY);
            token = null;
          } else if (!token) {
            setAccountError("Could not confirm this Google account. Check the connection and try again.");
            setAccountGate("error");
            return;
          }
        } catch {
          if (cancelled) return;
          if (!token) {
            setAccountError("Could not confirm this Google account. Check the connection and try again.");
            setAccountGate("error");
            return;
          }
        }
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
      if (cancelled) return;
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else await clearCache();
      setLinked(Boolean(token));
      setAccountGate("ready");
    })();
    return () => { cancelled = true; };
  }, [userId, ready, accountTry]);

  useEffect(() => {
    if (linked && accountGate === "ready") void init();
  }, [linked, accountGate, init]);

  // A fresh QR scan while already linked re-links as a new device.
  const showLink = !linked || Boolean(pairCode);
  const [linkPhase, setLinkPhase] = useState<"probing" | "code" | "claiming" | "blocked" | "done" | null>(null);
  const [cameFromLogin] = useState(() => sessionStorage.getItem("nimbus.signingIn") === "1" || new URLSearchParams(location.search).has("code"));
  const [holdLogin, setHoldLogin] = useState(cameFromLogin);
  const reducedMotion = useReducedMotion();
  const quietBootstrap = Boolean(session) && showLink && !pairCode && linkPhase !== "code" && linkPhase !== "blocked";
  const workspaceReady = Boolean(session) && accountGate === "ready" && !quietBootstrap;

  useEffect(() => {
    if (!cameFromLogin || !holdLogin) return;
    if (accountGate === "error") {
      sessionStorage.removeItem("nimbus.signingIn");
      setHoldLogin(false);
      return;
    }
    if (!workspaceReady) return;
    const delay = reducedMotion ? 0 : 420;
    const timer = window.setTimeout(() => {
      sessionStorage.removeItem("nimbus.signingIn");
      setHoldLogin(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [accountGate, cameFromLogin, holdLogin, reducedMotion, workspaceReady]);

  const presentLogin = !session || ((accountGate === "checking" || quietBootstrap || holdLogin) && cameFromLogin);
  let visual: "loading" | "signin" | "error" | "link" | "app" = "app";
  if (!ready && !session) visual = cameFromLogin && holdLogin ? "signin" : "loading";
  else if (accountGate === "error") visual = "error";
  else if (presentLogin) visual = "signin";
  else if (accountGate === "checking") visual = "loading";
  else if (showLink) visual = "link";
  else visual = "app";

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("workspace", visual === "app");
    return () => document.documentElement.classList.remove("workspace");
  }, [visual]);

  const finishLink = () => {
    if (location.hash.startsWith("#/pair/")) history.replaceState(null, "", location.pathname);
    setPairCode(undefined);
    setLinked(true);
  };

  if (showLanding) {
    return (
      <TooltipProvider delay={300}>
        <LandingPage onLaunchApp={() => setShowLanding(false)} />
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delay={300}>
      <div className="relative h-dvh overflow-hidden bg-background">
        <AnimatePresence initial={false} mode="sync">
          {visual === "loading" ? (
            <Stage key="loading" reduced={reducedMotion} enter="fade" exit="fade" className="z-10">
              <div className="flex h-full items-center justify-center"><NimbusLoader label="Checking your account…" /></div>
            </Stage>
          ) : visual === "signin" ? (
            <Stage key="signin" reduced={reducedMotion} enter="fade" exit="through" className="signin-stage z-10">
              <SignIn leaving={Boolean(session) && visual === "signin"} />
            </Stage>
          ) : visual === "error" ? (
            <Stage key="account-error" reduced={reducedMotion} enter="fade" exit="fade" className="z-10">
              <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                <h1 className="text-xl font-semibold tracking-tight">Couldn’t open your account</h1>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{accountError}</p>
                <button type="button" onClick={() => setAccountTry((n) => n + 1)} className="mt-6 h-12 rounded-xl bg-primary px-5 text-base font-medium text-primary-foreground">Try again</button>
                <button type="button" onClick={() => void signOut()} className="mt-3 h-12 rounded-xl px-5 text-base font-medium text-muted-foreground">Sign out</button>
              </div>
            </Stage>
          ) : visual === "app" ? (
            <Stage key="app" reduced={reducedMotion} enter="rise" exit="fade" className="workspace z-20">
              <Shell />
            </Stage>
          ) : null}
        </AnimatePresence>
        {session && showLink && (
          <motion.div
            className="absolute inset-0 z-30"
            initial={false}
            animate={{ opacity: visual === "link" ? 1 : 0 }}
            style={{ visibility: visual === "link" ? "visible" : "hidden" }}
            transition={reducedMotion || visual !== "link" ? { duration: 0 } : { duration: 0.45, ease: STAGE_EASE }}
          >
            <LinkDevice initialCode={pairCode} onPhase={setLinkPhase} onLinked={finishLink} />
          </motion.div>
        )}
      </div>
      <Toaster position="top-center" richColors closeButton />
    </TooltipProvider>
  );
}

const STAGE_EASE = [0.22, 1, 0.36, 1] as const;

function Stage({
  reduced,
  enter,
  exit,
  className,
  children,
}: {
  reduced: boolean;
  enter: "fade" | "rise";
  exit: "fade" | "through";
  className?: string;
  children: ReactNode;
}) {
  const fade = { duration: reduced ? 0.01 : 0.35, ease: STAGE_EASE };
  const through = { duration: reduced ? 0.01 : 0.62, ease: STAGE_EASE };
  const rise = { duration: reduced ? 0.01 : 0.72, ease: STAGE_EASE, delay: reduced ? 0 : 0.06 };
  const node = useRef<HTMLDivElement>(null);
  return (
    <motion.div
      ref={node}
      onAnimationComplete={() => {
        if (node.current) node.current.style.transform = "none";
      }}
      className={cn("absolute inset-0 overflow-hidden bg-background", className)}
      initial={reduced ? { opacity: 0 } : enter === "rise" ? { opacity: 0, y: 32, scale: 0.972 } : { opacity: 0 }}
      animate={reduced ? { opacity: 1, transition: fade } : { opacity: 1, y: 0, scale: 1, transition: enter === "rise" ? rise : fade }}
      exit={
        reduced
          ? { opacity: 0, transition: fade }
          : exit === "through"
            ? { opacity: 0, scale: 1.035, transition: through }
            : { opacity: 0, y: 10, transition: fade }
      }
    >
      {children}
    </motion.div>
  );
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
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
        <UpgradeModal />
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
      <UpgradeModal />
    </div>
  );
}
