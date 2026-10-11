import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMessages, useStore } from "@/lib/store";
import { Composer } from "./Composer";
import { EmptyState } from "./EmptyState";
import { MessageItem } from "./MessageItem";

export function Thread() {
  const selectedId = useStore((s) => s.selectedId);
  const messages = useMessages(selectedId);
  const loaded = useStore((s) => (selectedId ? Boolean(s.loaded[selectedId]) : true));
  const approvals = useStore((s) => s.approvals);
  const devices = useStore((s) => s.devices);
  const run = useStore((s) => (selectedId ? s.runs[selectedId] : undefined));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);

  const deviceNames = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, d.name])), [devices]);

  // Keep pinned to the bottom while streaming unless the user scrolled up.
  const lastSig = messages.length ? `${messages[messages.length - 1].id}:${messages[messages.length - 1].parts.length}:${messages[messages.length - 1].updatedAt}` : "";
  const lastLen = messages.length ? JSON.stringify(messages[messages.length - 1].parts).length : 0;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !stuck) return;
    el.scrollTop = el.scrollHeight;
  }, [lastSig, lastLen, stuck, selectedId]);

  useEffect(() => {
    setStuck(true);
    const el = scrollRef.current;
    if (el) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight));
  }, [selectedId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const showEmpty = !selectedId || (loaded && messages.length === 0);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {showEmpty ? (
          <EmptyState />
        ) : (
          <div className="mx-auto w-full max-w-3xl px-3 pt-4 pb-6 sm:px-6">
            {!loaded && messages.length === 0 && (
              <div className="space-y-6 py-4">
                <div className="flex justify-end"><Skeleton className="h-10 w-2/3 rounded-3xl" /></div>
                <div className="space-y-2"><Skeleton className="h-4 w-11/12" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-2/3" /></div>
                <div className="flex justify-end"><Skeleton className="h-10 w-1/2 rounded-3xl" /></div>
                <div className="space-y-2"><Skeleton className="h-4 w-10/12" /><Skeleton className="h-4 w-3/5" /></div>
              </div>
            )}
            {messages.map((m, i) => (
              <MessageItem key={m.id} message={m} isLast={i === messages.length - 1} approvals={approvals.filter((a) => a.messageId === m.id)} deviceName={m.deviceId ? deviceNames[m.deviceId] : undefined} />
            ))}
            <AnimatePresence>
              {run && run.state !== "idle" && (
                <motion.div key="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1 flex items-center gap-2 pl-10 text-xs text-muted-foreground">
                  <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" /><span className="relative inline-flex size-2 rounded-full bg-primary" /></span>
                  <span className="shimmer-text">{run.state === "tool" ? `Running ${run.detail ?? "tool"}` : run.state === "waiting_user" ? "Waiting for you" : "Thinking"}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      <AnimatePresence>
        {!stuck && !showEmpty && (
          <motion.div key="jump" initial={{ opacity: 0, y: 8, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.9 }} className="pointer-events-none absolute right-0 bottom-28 left-0 flex justify-center">
            <Button size="icon-sm" variant="outline" className="pointer-events-auto rounded-full elevation-2" onClick={() => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); setStuck(true); }} aria-label="Jump to latest"><ArrowDown /></Button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="shrink-0 bg-gradient-to-t from-background via-background/95 to-transparent pt-2 safe-bottom">
        <Composer />
      </div>
    </div>
  );
}
