import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Bot, ChevronDown, MessageSquare, Sparkles, Square } from "lucide-react";
import { toast } from "sonner";
import type { AgentMode } from "@nimbus/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useConversation, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const MODES: { value: AgentMode; label: string; hint: string; icon: typeof Bot }[] = [
  { value: "agent", label: "Agent", hint: "Full tools: edit files, run commands, search", icon: Bot },
  { value: "plan", label: "Plan", hint: "Read-only research, then a plan to approve", icon: Sparkles },
  { value: "chat", label: "Chat", hint: "Conversation and web only, no edits", icon: MessageSquare },
];

const SLASH: { cmd: string; hint: string }[] = [
  { cmd: "/plan", hint: "Switch this chat to plan mode" },
  { cmd: "/agent", hint: "Switch to agent mode" },
  { cmd: "/chat", hint: "Switch to chat mode" },
  { cmd: "/skills", hint: "List available skills" },
  { cmd: "/memory", hint: "Remember something: /memory <text>" },
];

export function Composer() {
  const selectedId = useStore((s) => s.selectedId);
  const conversation = useConversation(selectedId);
  const draftMode = useStore((s) => s.draftMode);
  const setDraftMode = useStore((s) => s.setDraftMode);
  const sendMessage = useStore((s) => s.sendMessage);
  const send = useStore((s) => s.send);
  const connection = useStore((s) => s.connection);
  const running = useStore((s) => (selectedId ? Boolean(s.runs[selectedId]) : false));
  const skills = useStore((s) => s.skills);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const mode = conversation?.mode ?? draftMode;
  const isTouch = window.matchMedia("(pointer: coarse)").matches;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  useEffect(() => {
    if (!isTouch) ref.current?.focus();
  }, [selectedId, isTouch]);

  const setMode = async (m: AgentMode) => {
    if (conversation) {
      await send({ type: "conversation.update", conversationId: conversation.id, patch: { mode: m } }).catch((e) => toast.error((e as Error).message));
    } else setDraftMode(m);
  };

  const submit = async () => {
    const text = value.trim();
    if (!text || busy || running) return;
    if (text.startsWith("/")) {
      const [cmd, ...rest] = text.split(/\s+/);
      if (cmd === "/plan" || cmd === "/agent" || cmd === "/chat") {
        await setMode(cmd.slice(1) as AgentMode);
        setValue("");
        toast.success(`${cmd.slice(1)[0].toUpperCase()}${cmd.slice(2)} mode`);
        return;
      }
      if (cmd === "/skills") {
        setValue("");
        toast(skills.length ? `Skills: ${skills.map((s) => s.name).join(", ")}` : "No skills found. Add SKILL.md packages under .nimbus/skills in your workspace.");
        return;
      }
      if (cmd === "/memory") {
        setValue(`Remember this for future sessions: ${rest.join(" ")}`);
        return;
      }
    }
    setBusy(true);
    setValue("");
    try {
      await sendMessage(text);
    } catch {
      setValue(text);
    } finally {
      setBusy(false);
      if (!isTouch) ref.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isTouch && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const stop = () => selectedId && send({ type: "run.cancel", conversationId: selectedId }).catch((e) => toast.error((e as Error).message));
  const showSlash = value.startsWith("/") && !value.includes(" ");
  const offline = connection !== "online";
  const current = MODES.find((m) => m.value === mode)!;

  return (
    <div className="relative mx-auto w-full max-w-3xl px-2 pb-2 sm:px-6 sm:pb-5">
      <AnimatePresence>
        {showSlash && (
          <motion.ul initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} className="absolute right-3 bottom-full left-3 z-10 mb-2 overflow-hidden rounded-xl border bg-popover p-1 elevation-3 sm:right-6 sm:left-6">
            {SLASH.filter((s) => s.cmd.startsWith(value)).map((s) => (
              <li key={s.cmd}>
                <button type="button" onClick={() => { setValue(s.cmd === "/memory" ? "/memory " : s.cmd); ref.current?.focus(); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                  <span className="font-mono">{s.cmd}</span><span className="text-xs text-muted-foreground">{s.hint}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <motion.div
        layout
        className={cn("rounded-[26px] border bg-surface-raised p-2 elevation-2 transition-shadow focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10", running && "border-primary/30")}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={running ? "Nimbus is working…" : mode === "plan" ? "Describe what to plan…" : mode === "chat" ? "Ask anything…" : "Ask Nimbus to build, fix, research…"}
          enterKeyHint="send"
          autoCapitalize="sentences"
          className="max-h-[220px] w-full resize-none bg-transparent px-3 pt-2 pb-1 text-base leading-relaxed outline-none placeholder:text-muted-foreground/70 lg:text-[15px]"
          disabled={offline && !value}
          aria-label="Message"
        />
        <div className="flex items-center gap-1 px-1 pt-1">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="gap-1.5 rounded-full text-muted-foreground" />}>
              <current.icon className="size-3.5" />
              {current.label}
              <ChevronDown className="size-3 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {MODES.map((m) => (
                <DropdownMenuItem key={m.value} onClick={() => void setMode(m.value)} className="flex items-start gap-2.5 py-2">
                  <m.icon className="mt-0.5 size-4 text-muted-foreground" />
                  <span><span className="block text-sm font-medium">{m.label}{m.value === mode && <span className="ml-2 text-xs text-primary">current</span>}</span><span className="block text-xs text-muted-foreground">{m.hint}</span></span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="ml-1 hidden text-[11px] text-muted-foreground sm:inline">{offline ? "Offline — reconnecting…" : "Enter to send · Shift+Enter for a new line · / for commands"}</span>
          <div className="ml-auto">
            <AnimatePresence mode="wait" initial={false}>
              {running ? (
                <motion.div key="stop" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}>
                  <Button onClick={stop} size="icon" className="rounded-full max-lg:size-11" variant="secondary" aria-label="Stop"><Square className="size-3.5 fill-current" /></Button>
                </motion.div>
              ) : (
                <motion.div key="send" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}>
                  <Button onClick={() => void submit()} size="icon" className="rounded-full max-lg:size-11" disabled={!value.trim() || busy || offline} aria-label="Send"><ArrowUp /></Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
