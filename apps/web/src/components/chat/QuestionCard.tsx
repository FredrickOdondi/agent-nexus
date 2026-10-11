import { useState } from "react";
import { motion } from "motion/react";
import { Check, MessageCircleQuestion, Send } from "lucide-react";
import { toast } from "sonner";
import type { QuestionPart } from "@nimbus/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";

export function QuestionCard({ part, conversationId, messageId, live }: { part: QuestionPart; conversationId: string; messageId: string; live: boolean }) {
  const send = useStore((s) => s.send);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const answered = Boolean(part.answer);

  const answer = async (value: string) => {
    if (!value.trim() || busy) return;
    setBusy(true);
    try {
      await send({ type: "question.answer", conversationId, messageId, questionId: part.id, answer: value.trim() });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isPlan = /^Approve this plan\?/.test(part.question);
  const [title, ...rest] = isPlan ? part.question.split("\n\n") : [part.question];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      className={cn("my-2 overflow-hidden rounded-2xl border bg-surface-raised elevation-2", !answered && live && "border-primary/40 ring-2 ring-primary/10")}
    >
      <div className="flex items-start gap-3 px-4 pt-3.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><MessageCircleQuestion className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          {rest.length > 0 && (
            <div className="mt-2 max-h-72 overflow-auto rounded-lg border bg-background p-3">
              <Markdown text={rest.join("\n\n")} className="text-sm" />
            </div>
          )}
        </div>
      </div>
      <div className="grid gap-2 px-4 pt-3 pb-4 sm:grid-cols-2">
        {part.options.map((o) => {
          const chosen = part.answer === o.label;
          return (
            <button
              key={o.label}
              type="button"
              disabled={answered || !live || busy}
              onClick={() => answer(o.label)}
              className={cn(
                "group flex min-h-12 items-start gap-2.5 rounded-xl border px-3 py-3 text-left transition-all sm:py-2.5",
                !answered && live && "hover:border-primary/60 hover:bg-primary/5 active:scale-[0.99]",
                chosen && "border-primary bg-primary/10",
                answered && !chosen && "opacity-50",
              )}
            >
              <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", chosen && "border-primary bg-primary text-primary-foreground")}>{chosen && <Check className="size-3" />}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{o.label}</span>
                {o.description && <span className="block text-xs text-muted-foreground">{o.description}</span>}
              </span>
            </button>
          );
        })}
      </div>
      {!answered && live && part.allowFreeform && (
        <form
          className="flex items-center gap-2 border-t px-4 py-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            void answer(custom);
          }}
        >
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Or type your own answer…" className="h-9" />
          <Button type="submit" size="icon" disabled={!custom.trim() || busy} aria-label="Send answer"><Send /></Button>
        </form>
      )}
      {answered && (
        <div className="border-t px-4 py-2 text-xs text-muted-foreground">
          Answered{part.answeredBy ? ` from ${part.answeredBy}` : ""}: <span className="font-medium text-foreground">{part.answer}</span>
        </div>
      )}
    </motion.div>
  );
}
