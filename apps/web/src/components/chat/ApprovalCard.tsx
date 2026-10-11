import { useRef, useState } from "react";
import { motion } from "motion/react";
import { ShieldCheck, ShieldX } from "lucide-react";
import { toast } from "sonner";
import type { ApprovalRequest } from "@nimbus/shared";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";

/**
 * Permission prompt rendered inline in the thread. Any linked device can
 * answer; the first answer wins and the others see it resolve.
 */
export function ApprovalCard({ request }: { request: ApprovalRequest }) {
  const send = useStore((s) => s.send);
  const [busy, setBusy] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const sent = useRef(false);
  const decide = async (decision: "allow" | "allow_always" | "deny") => {
    if (sent.current) return;
    sent.current = true;
    setBusy(decision);
    try {
      await send({ type: "approval.respond", approvalId: request.id, decision });
    } catch (e) {
      const message = (e as Error).message;
      if (message === "Approval request no longer pending") {
        setHidden(true);
        return;
      }
      sent.current = false;
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };
  if (hidden) return null;
  const argsPreview = JSON.stringify(request.args, null, 2);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className="my-2 overflow-hidden rounded-2xl border border-warning/50 bg-surface-raised elevation-2"
    >
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning"><ShieldCheck className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">Allow Nimbus to run <span className="font-mono text-primary">{request.title}</span>?</p>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-[var(--code-bg)] px-3 py-2 font-mono text-xs whitespace-pre-wrap">{request.summary || argsPreview}</pre>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5">
        <Button onClick={() => decide("allow")} disabled={busy !== null} size="sm"><ShieldCheck /> Allow once</Button>
        <Button onClick={() => decide("allow_always")} disabled={busy !== null} size="sm" variant="secondary">Allow for this chat</Button>
        <Button onClick={() => decide("deny")} disabled={busy !== null} size="sm" variant="ghost" className="ml-auto text-destructive hover:text-destructive"><ShieldX /> Deny</Button>
      </div>
    </motion.div>
  );
}
