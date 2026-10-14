import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, SquarePen } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const newChat = useStore((s) => s.newChat);
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
            <header className="relative z-10 flex shrink-0 items-center justify-between border-b bg-background/85 px-2 pt-[env(safe-area-inset-top)] glass min-h-[46px]">
              <button type="button" onClick={showList} className="flex h-11 items-center gap-0.5 rounded-lg px-1.5 text-[16px] font-medium text-primary active:opacity-60">
                <ChevronLeft className="size-5.5" />
                <span>Chats</span>
              </button>
              <div className="pointer-events-none flex flex-col items-center px-2 min-w-0 max-w-[55%]">
                <h2 className="max-w-full truncate text-[15px] leading-tight font-semibold">{title}</h2>
                <p className="max-w-full truncate text-[11px] text-muted-foreground">{subtitle}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => {
                    newChat();
                  }}
                  className="rounded-full text-muted-foreground hover:text-foreground"
                  aria-label="New chat"
                >
                  <SquarePen className="size-4.5" />
                </Button>
              </div>
            </header>
            <Thread />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
