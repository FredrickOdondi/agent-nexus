import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft } from "lucide-react";
import { useConversation, useStore } from "@/lib/store";
import { Sidebar } from "./Sidebar";
import { Thread } from "@/components/chat/Thread";

/**
 * Phone layout: a full-screen chat list, then a conversation that slides in
 * over it. The system back button returns to the list.
 */
export function MobileShell() {
  const [screen, setScreen] = useState<"list" | "thread">("list");
  const selectedId = useStore((s) => s.selectedId);
  const conversation = useConversation(selectedId);
  const draftMode = useStore((s) => s.draftMode);
  const run = useStore((s) => (selectedId ? s.runs[selectedId] : undefined));
  const connection = useStore((s) => s.connection);

  useEffect(() => {
    const vv = window.visualViewport;
    const sync = () => {
      const height = vv?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${height}px`);
    };
    sync();
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
      window.removeEventListener("orientationchange", sync);
      document.documentElement.style.removeProperty("--app-height");
    };
  }, []);

  const showThread = useCallback(() => {
    setScreen("thread");
    if (history.state?.nimbus !== "thread") history.pushState({ nimbus: "thread" }, "");
  }, []);

  const showList = useCallback(() => {
    if (history.state?.nimbus === "thread") history.back();
    else setScreen("list");
  }, []);

  useEffect(() => {
    const onPop = () => setScreen(history.state?.nimbus === "thread" ? "thread" : "list");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    return useStore.subscribe((state, prev) => {
      if (state.selectedId && state.selectedId !== prev.selectedId) showThread();
    });
  }, [showThread]);

  const title = conversation?.title ?? "New chat";
  const mode = conversation?.mode ?? draftMode;
  const subtitle =
    connection !== "online" ? (connection === "connecting" ? "Connecting…" : "Offline")
    : run && run.state !== "idle" ? (run.state === "tool" ? `Running ${run.detail ?? "a tool"}` : run.state === "waiting_user" ? "Waiting for you" : "Thinking…")
    : mode === "plan" ? "Plan" : mode === "chat" ? "Chat" : "Agent";

  return (
    <div className="mobile-app relative overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0" aria-hidden={screen === "thread"}>
        <Sidebar variant="inbox" onNavigate={showThread} />
      </div>
      <AnimatePresence>
        {screen === "thread" && (
          <motion.div
            key="thread"
            className="absolute inset-0 z-10 flex flex-col bg-background"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 40 }}
          >
            <header className="relative z-10 flex shrink-0 items-center gap-1 border-b bg-background/85 px-1 pt-[env(safe-area-inset-top)] glass">
              <button type="button" onClick={showList} className="flex h-12 items-center gap-0.5 rounded-lg px-1 text-[17px] text-primary active:opacity-60">
                <ChevronLeft className="size-6" />
                Chats
              </button>
              <div className="pointer-events-none absolute inset-x-24 bottom-1.5 flex flex-col items-center">
                <h2 className="max-w-full truncate text-[17px] leading-tight font-semibold">{title}</h2>
                <p className="max-w-full truncate text-[11px] text-muted-foreground">{subtitle}</p>
              </div>
              <span className="ml-auto w-16" aria-hidden />
            </header>
            <Thread />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
