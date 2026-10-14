import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ChangeEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, Bot, ChevronDown, MessageSquare, Sparkles, Square, X } from "lucide-react";
import { toast } from "sonner";
import type { AgentMode, SubagentInfo } from "@nimbus/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConversation, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { SubagentAvatar, colorwayFor } from "@/components/brand/ChatAvatar";

const MODES: { value: AgentMode; label: string; hint: string; icon: typeof Bot }[] = [
  { value: "agent", label: "Agent", hint: "Full tools: edit files, run commands, search", icon: Bot },
  { value: "plan", label: "Plan", hint: "Read-only research, then a plan to approve", icon: Sparkles },
  { value: "chat", label: "Chat", hint: "Conversation and web only, no edits", icon: MessageSquare },
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
  const subagents = useStore((s) => s.subagents);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedSubagent, setSelectedSubagent] = useState<SubagentInfo | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const mode = conversation?.mode ?? draftMode;
  const isTouch = window.matchMedia("(pointer: coarse)").matches;

  useEffect(() => {
    setSelectedSubagent(null);
  }, [selectedId]);

  const activeSubagent = useMemo(() => {
    if (!selectedSubagent) return null;
    return subagents.find((sa) => sa.name.toLowerCase() === selectedSubagent.name.toLowerCase()) ?? selectedSubagent;
  }, [selectedSubagent, subagents]);

  const activeColorway = useMemo(() => {
    if (!activeSubagent) return null;
    return colorwayFor(activeSubagent.avatar || activeSubagent.name);
  }, [activeSubagent]);

  const slashCommands = useMemo(() => {
    const list: { cmd: string; hint: string; kind: "mode" | "command" | "subagent" | "skill"; badge?: string; avatar?: string }[] = [
      { cmd: "/agent", hint: "Switch to full agent mode", kind: "mode", badge: "mode" },
      { cmd: "/plan", hint: "Switch this chat to plan mode", kind: "mode", badge: "mode" },
      { cmd: "/chat", hint: "Switch to conversation mode", kind: "mode", badge: "mode" },
      { cmd: "/subagents", hint: "List all available subagents", kind: "command", badge: "command" },
      { cmd: "/skills", hint: "List available SKILL.md packages", kind: "command", badge: "command" },
      { cmd: "/memory", hint: "Remember something: /memory <text>", kind: "command", badge: "command" },
    ];

    for (const sa of subagents) {
      if (sa.scope === "builtin") continue;
      list.push({
        cmd: `/${sa.name}`,
        hint: sa.description || "Subagent",
        kind: "subagent",
        badge: "subagent",
        avatar: sa.avatar || sa.name,
      });
    }

    for (const sk of skills) {
      list.push({
        cmd: `/${sk.name}`,
        hint: sk.description || "Skill package",
        kind: "skill",
        badge: "skill",
      });
    }

    return list;
  }, [subagents, skills]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  useEffect(() => {
    if (!isTouch) ref.current?.focus();
  }, [selectedId, isTouch]);

  const showSlash = value.startsWith("/") && !value.includes(" ");
  const filteredSlash = useMemo(() => {
    if (!showSlash) return [];
    return slashCommands.filter((s) => s.cmd.toLowerCase().startsWith(value.toLowerCase()));
  }, [showSlash, slashCommands, value]);

  useEffect(() => {
    setSlashIndex(0);
  }, [value]);

  const applySlashCommand = (s: (typeof slashCommands)[number]) => {
    if (s.kind === "subagent") {
      const sa = subagents.find((item) => item.name.toLowerCase() === s.cmd.slice(1).toLowerCase());
      if (sa) {
        setSelectedSubagent(sa);
        setValue("");
        ref.current?.focus();
        return;
      }
    }
    setSelectedSubagent(null);
    setValue(s.kind === "skill" || s.cmd === "/memory" ? `${s.cmd} ` : s.cmd);
    ref.current?.focus();
  };

  const setMode = async (m: AgentMode) => {
    if (conversation) {
      await send({ type: "conversation.update", conversationId: conversation.id, patch: { mode: m } }).catch((e) => toast.error((e as Error).message));
    } else setDraftMode(m);
  };

  const submit = async () => {
    if (busy || running) return;

    if (activeSubagent) {
      const query = value.trim();
      if (!query) {
        toast.info(`Please enter instructions for the /${activeSubagent.name} subagent`);
        return;
      }
      setBusy(true);
      setValue("");
      const sa = activeSubagent;
      setSelectedSubagent(null);
      toast.success(`Delegating to ${sa.name} subagent...`);
      try {
        await sendMessage(
          `[Subagent: ${sa.name}] Please delegate this task to the '${sa.name}' subagent using the task tool (subagent_type="${sa.name}"): ${query}`
        );
      } catch {
        setSelectedSubagent(sa);
        setValue(query);
      } finally {
        setBusy(false);
        if (!isTouch) ref.current?.focus();
      }
      return;
    }

    const text = value.trim();
    if (!text) return;
    if (text.startsWith("/")) {
      const [cmd, ...rest] = text.split(/\s+/);
      const query = rest.join(" ").trim();
      const cleanCmd = cmd.slice(1).toLowerCase();

      if (cmd === "/plan" || cmd === "/agent" || cmd === "/chat") {
        await setMode(cmd.slice(1) as AgentMode);
        setValue("");
        toast.success(`${cmd.slice(1)[0].toUpperCase()}${cmd.slice(2)} mode`);
        return;
      }
      if (cmd === "/skills") {
        setValue("");
        toast(skills.length ? `Skills (${skills.length}): ${skills.map((s) => s.name).join(", ")}` : "No skills found. Add SKILL.md packages under .nimbus/skills in your workspace.");
        return;
      }
      if (cmd === "/subagents") {
        setValue("");
        toast(subagents.length ? `Subagents (${subagents.length}): ${subagents.map((s) => `/${s.name} (${s.scope ?? "custom"})`).join(", ")}` : "No subagents found.");
        return;
      }
      if (cmd === "/memory") {
        setValue(`Remember this for future sessions: ${rest.join(" ")}`);
        return;
      }

      const matchingSubagent = subagents.find((s) => s.name.toLowerCase() === cleanCmd);
      if (matchingSubagent) {
        if (!query) {
          setSelectedSubagent(matchingSubagent);
          setValue("");
          toast.info(`Please enter instructions for the /${matchingSubagent.name} subagent`);
          return;
        }
        setBusy(true);
        setValue("");
        toast.success(`Delegating to ${matchingSubagent.name} subagent...`);
        try {
          await sendMessage(`[Subagent: ${matchingSubagent.name}] Please delegate this task to the '${matchingSubagent.name}' subagent using the task tool (subagent_type="${matchingSubagent.name}"): ${query}`);
        } catch {
          setValue(text);
        } finally {
          setBusy(false);
          if (!isTouch) ref.current?.focus();
        }
        return;
      }

      const matchingSkill = skills.find((s) => s.name.toLowerCase() === cleanCmd);
      if (matchingSkill) {
        setBusy(true);
        setValue("");
        try {
          await sendMessage(`[Skill: ${matchingSkill.name}] ${query || "Execute this skill"}`);
        } catch {
          setValue(text);
        } finally {
          setBusy(false);
          if (!isTouch) ref.current?.focus();
        }
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
    if (showSlash && filteredSlash.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((prev) => (prev + 1) % filteredSlash.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((prev) => (prev - 1 + filteredSlash.length) % filteredSlash.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const chosen = filteredSlash[slashIndex];
        if (chosen) {
          applySlashCommand(chosen);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setValue("");
        return;
      }
    }

    if (e.key === "Backspace" && !value && selectedSubagent) {
      e.preventDefault();
      setSelectedSubagent(null);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey && !isTouch && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (!activeSubagent && val.startsWith("/")) {
      const spaceIdx = val.indexOf(" ");
      if (spaceIdx > 1) {
        const candidate = val.slice(1, spaceIdx).toLowerCase();
        const matched = subagents.find((sa) => sa.scope !== "builtin" && sa.name.toLowerCase() === candidate);
        if (matched) {
          setSelectedSubagent(matched);
          setValue(val.slice(spaceIdx + 1));
          return;
        }
      }
    }
    setValue(val);
  };

  const stop = () => selectedId && send({ type: "run.cancel", conversationId: selectedId }).catch((e) => toast.error((e as Error).message));
  const offline = connection !== "online";
  const current = MODES.find((m) => m.value === mode)!;

  return (
    <div className="relative mx-auto w-full max-w-3xl px-2 pb-2 sm:px-6 sm:pb-5">
      <AnimatePresence>
        {showSlash && (
          <motion.ul initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.15 }} className="absolute right-3 bottom-full left-3 z-10 mb-2 max-h-64 overflow-y-auto rounded-xl border bg-popover p-1 elevation-3 sm:right-6 sm:left-6">
            {filteredSlash.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">No commands matching &apos;{value}&apos;</li>
            ) : (
              filteredSlash.slice(0, 20).map((s, idx) => {
                const isSelected = idx === slashIndex;
                const cw = s.kind === "subagent" ? colorwayFor(s.avatar || s.cmd.slice(1)) : null;

                return (
                  <li key={s.cmd} className="block">
                    <button
                      type="button"
                      onMouseEnter={() => setSlashIndex(idx)}
                      onClick={() => applySlashCommand(s)}
                      className={cn(
                        "flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2 text-left text-sm transition-all",
                        isSelected ? "bg-muted/90" : "hover:bg-muted/70 active:bg-muted"
                      )}
                      style={
                        cw && isSelected
                          ? {
                              backgroundColor: cw.bg,
                              boxShadow: `0 0 14px ${cw.palette[0]}35`,
                            }
                          : undefined
                      }
                    >
                      <div className="flex shrink-0 items-center gap-2">
                        {s.kind === "subagent" && (
                          <SubagentAvatar seed={s.avatar || s.cmd.slice(1)} avatar={s.avatar} size={20} className="shrink-0" />
                        )}
                        <span
                          className={cn("font-mono font-medium whitespace-nowrap transition-colors", !cw && "text-foreground")}
                          style={
                            cw
                              ? {
                                  color: cw.palette[1],
                                  textShadow: `0 0 10px ${cw.palette[0]}80`,
                                }
                              : undefined
                          }
                        >
                          {s.cmd}
                        </span>
                        {s.badge && (
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap shrink-0",
                              s.kind === "subagent"
                                ? "border"
                                : s.kind === "skill"
                                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                                : "bg-muted text-muted-foreground"
                            )}
                            style={
                              cw
                                ? {
                                    backgroundColor: cw.bg,
                                    color: cw.palette[1],
                                    borderColor: `${cw.palette[0]}50`,
                                    boxShadow: `0 0 8px ${cw.palette[0]}35`,
                                  }
                                : undefined
                            }
                          >
                            {s.badge}
                          </span>
                        )}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{s.hint}</span>
                    </button>
                  </li>
                );
              })
            )}
          </motion.ul>
        )}
      </AnimatePresence>
      <motion.div
        layout
        style={
          activeColorway
            ? {
                borderColor: `${activeColorway.palette[0]}80`,
                boxShadow: `0 0 24px ${activeColorway.palette[0]}22, 0 0 2px ${activeColorway.palette[0]}50`,
              }
            : undefined
        }
        className={cn(
          "rounded-[26px] border bg-surface-raised p-2 elevation-2 transition-all focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10",
          running && "border-primary/30"
        )}
      >
        {activeSubagent && activeColorway && (
          <div className="flex items-center justify-between px-2 pt-1 pb-1.5">
            <div
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-mono font-medium transition-all"
              style={{
                backgroundColor: activeColorway.bg,
                borderColor: activeColorway.palette[0],
                borderWidth: "1px",
                color: activeColorway.palette[1],
                boxShadow: `0 0 16px ${activeColorway.palette[0]}60, 0 0 4px ${activeColorway.palette[1]}90, inset 0 0 10px ${activeColorway.palette[0]}15`,
                textShadow: `0 0 8px ${activeColorway.palette[0]}75`,
              }}
            >
              <SubagentAvatar seed={activeSubagent.avatar || activeSubagent.name} avatar={activeSubagent.avatar} size={18} />
              <span className="font-semibold tracking-wide">/{activeSubagent.name}</span>
              <button
                type="button"
                onClick={() => setSelectedSubagent(null)}
                className="ml-0.5 rounded-full p-0.5 opacity-70 transition-opacity hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10"
                aria-label={`Remove /${activeSubagent.name}`}
              >
                <X className="size-3" />
              </button>
            </div>
            <span
              className="text-[11px] font-medium tracking-wide uppercase"
              style={{
                color: activeColorway.palette[1],
                textShadow: `0 0 10px ${activeColorway.palette[0]}50`,
              }}
            >
              Subagent Active
            </span>
          </div>
        )}
        <textarea
          ref={ref}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={
            running
              ? "Nimbus is working…"
              : activeSubagent
              ? `Instructions for /${activeSubagent.name}…`
              : mode === "plan"
              ? "Describe what to plan…"
              : mode === "chat"
              ? "Ask anything…"
              : "Ask Nimbus to build, fix, research…"
          }
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
          {offline && <span className="ml-1 text-[11px] text-muted-foreground">Offline — reconnecting…</span>}
          <div className="ml-auto">
            <AnimatePresence mode="wait" initial={false}>
              {running ? (
                <motion.div key="stop" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}>
                  <Button onClick={stop} size="icon" className="rounded-full max-lg:size-11" variant="secondary" aria-label="Stop"><Square className="size-3.5 fill-current" /></Button>
                </motion.div>
              ) : (
                <motion.div key="send" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }}>
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Button onClick={() => void submit()} size="icon" className="rounded-full max-lg:size-11" disabled={!value.trim() || busy || offline} aria-label="Send"><ArrowUp /></Button>
                    </TooltipTrigger>
                    <TooltipContent>Enter to send. Shift+Enter for a new line. Type / for commands.</TooltipContent>
                  </Tooltip>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

