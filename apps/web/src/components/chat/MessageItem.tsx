import { memo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Brain, Check, ChevronRight, CircleAlert, Copy, History, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { ApprovalRequest, Message, Part } from "@nimbus/shared";
import { messageText } from "@nimbus/shared";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./ApprovalCard";
import { Markdown } from "./Markdown";
import { QuestionCard } from "./QuestionCard";
import { NimbusMark } from "@/components/brand/NimbusMark";
import { ToolCallCard } from "./ToolCallCard";

const spring = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;

export const MessageItem = memo(function MessageItem({ message, isLast, approvals, deviceName }: { message: Message; isLast: boolean; approvals: ApprovalRequest[]; deviceName?: string }) {
  if (message.role === "user") return <UserMessage message={message} deviceName={deviceName} />;
  return <AssistantMessage message={message} isLast={isLast} approvals={approvals} />;
});

function UserMessage({ message, deviceName }: { message: Message; deviceName?: string }) {
  const text = messageText(message);
  return (
    <motion.div initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring} className="group flex justify-end py-2">
      <div className="max-w-[85%] sm:max-w-[72%]">
        <div className="rounded-3xl rounded-br-lg bg-bubble-user px-4 py-2.5 text-base leading-relaxed text-bubble-user-foreground elevation-1 whitespace-pre-wrap lg:text-[15px]">{text}</div>
        <div className="mt-1 flex items-center justify-end gap-2 pr-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          {deviceName && <span>from {deviceName}</span>}
          <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </div>
    </motion.div>
  );
}

function AssistantMessage({ message, isLast, approvals }: { message: Message; isLast: boolean; approvals: ApprovalRequest[] }) {
  const send = useStore((s) => s.send);
  const streaming = message.status === "streaming";
  const text = messageText(message);
  const [copied, setCopied] = useState(false);
  const parts = coalesce(message.parts);
  const live = isLast && streaming;

  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const regenerate = () => send({ type: "message.regenerate", conversationId: message.conversationId, messageId: message.id }).catch((e) => toast.error((e as Error).message));
  const rewind = () => send({ type: "rewind", conversationId: message.conversationId, messageId: message.id }).catch((e) => toast.error((e as Error).message));

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={spring} className="group flex gap-3 py-2">
      <div className="mt-1 hidden shrink-0 sm:block"><NimbusMark state="static" size={28} /></div>
      <div className="min-w-0 flex-1">
        {parts.length === 0 && streaming && <Thinking />}
        {parts.map((p, i) => (
          <PartView key={partKey(p, i)} part={p} index={i} message={message} live={live} isLastPart={i === parts.length - 1} />
        ))}
        <AnimatePresence>
          {approvals.map((a) => (
            <ApprovalCard key={a.id} request={a} />
          ))}
        </AnimatePresence>
        {message.status === "cancelled" && <p className="mt-1 text-xs text-muted-foreground italic">Stopped.</p>}
        {!streaming && (
          <div className={cn("mt-1 flex items-center gap-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100", isLast && "[@media(hover:none)]:opacity-100")}>
            <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={copy} aria-label="Copy" />}>{copied ? <Check className="text-success" /> : <Copy />}</TooltipTrigger><TooltipContent>Copy</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={regenerate} aria-label="Regenerate" />}><RefreshCw /></TooltipTrigger><TooltipContent>Regenerate</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={rewind} aria-label="Rewind to here" />}><History /></TooltipTrigger><TooltipContent>Rewind: remove this and everything after</TooltipContent></Tooltip>
            {message.usage && <span className="ml-2 text-[11px] tabular-nums">{message.usage.inputTokens.toLocaleString()} in · {message.usage.outputTokens.toLocaleString()} out</span>}
            {message.model && <span className="ml-2 hidden text-[11px] sm:inline">{message.model}</span>}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function partKey(p: Part, i: number) {
  if (p.type === "tool_call") return `tc-${p.id}`;
  if (p.type === "question") return `q-${p.id}`;
  return `${p.type}-${i}`;
}

/** Merge adjacent text parts so markdown renders as one block. */
function coalesce(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (p.type === "text" && last?.type === "text") out[out.length - 1] = { type: "text", text: last.text + p.text };
    else if (p.type === "reasoning" && last?.type === "reasoning") out[out.length - 1] = { ...last, text: last.text + p.text };
    else out.push(p);
  }
  return out.filter((p) => !(p.type === "text" && !p.text.trim()));
}

function PartView({ part, message, live, isLastPart }: { part: Part; index: number; message: Message; live: boolean; isLastPart: boolean }) {
  switch (part.type) {
    case "text":
      return (
        <div className="relative">
          <Markdown text={part.text} />
          {live && isLastPart && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-caret bg-primary align-baseline" />}
        </div>
      );
    case "reasoning":
      return <Reasoning text={part.text} live={live && isLastPart} durationMs={part.durationMs} />;
    case "tool_call":
      return <ToolCallCard part={part} defaultOpen={part.status === "awaiting_approval"} />;
    case "question":
      return <QuestionCard part={part} conversationId={message.conversationId} messageId={message.id} live={message.status === "streaming"} />;
    case "citations":
      return (
        <div className="my-2 flex flex-wrap gap-1.5">
          {part.citations.map((c, i) => (
            <a key={i} href={c.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-full border bg-surface px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
              <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(c.url).hostname)}&sz=32`} alt="" className="size-3.5 rounded-sm" loading="lazy" />
              <span className="truncate">{c.title || new URL(c.url).hostname}</span>
            </a>
          ))}
        </div>
      );
    case "image":
      return (
        <motion.img initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={spring} src={part.url} alt={part.alt ?? ""} className="my-2 max-h-[420px] max-w-full rounded-2xl elevation-2" loading="lazy" />
      );
    case "error":
      return (
        <div className="my-2 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span className="break-words">{part.message}</span>
        </div>
      );
  }
}

function Reasoning({ text, live, durationMs }: { text: string; live: boolean; durationMs?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-1.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 rounded-md py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <Brain className={cn("size-3.5", live && "animate-pulse-soft text-primary")} />
        <span className={cn(live && "shimmer-text")}>{live ? "Thinking…" : `Thought${durationMs ? ` for ${Math.max(1, Math.round(durationMs / 1000))}s` : ""}`}</span>
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="ml-1 border-l-2 border-border pl-3 text-sm text-muted-foreground"><Markdown text={text} className="text-sm" /></div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Thinking() {
  return (
    <div className="flex h-8 items-center pl-0.5" aria-label="Nimbus is thinking">
      <NimbusMark state="loading" size={26} />
    </div>
  );
}
