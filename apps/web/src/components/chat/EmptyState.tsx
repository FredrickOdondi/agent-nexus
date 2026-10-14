import { motion } from "motion/react";
import { Bot, Code2, Globe, Lightbulb, ListTodo, MessageSquare, Sparkles, Terminal } from "lucide-react";
import type { AgentMode } from "@nimbus/shared";
import { NimbusMark } from "@/components/brand/NimbusMark";
import { useAuth } from "@/lib/auth";
import { accountFromSession } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

interface Suggestion {
  title: string;
  desc: string;
  prompt: string;
  icon: typeof Code2;
  color: string;
  bg: string;
}

const SUGGESTIONS: Suggestion[] = [
  {
    title: "Explore codebase",
    desc: "Map architecture, key modules & flow",
    prompt: "Explore the codebase and summarise the architecture, key modules and how they fit together.",
    icon: Code2,
    color: "text-indigo-500 dark:text-indigo-400",
    bg: "bg-indigo-500/10 dark:bg-indigo-500/20",
  },
  {
    title: "Run and fix",
    desc: "Run tests, read errors & auto-fix",
    prompt: "Run the test suite, read any failures, fix them and re-run until green.",
    icon: Terminal,
    color: "text-emerald-500 dark:text-emerald-400",
    bg: "bg-emerald-500/10 dark:bg-emerald-500/20",
  },
  {
    title: "Research sources",
    desc: "Search web with citations & links",
    prompt: "Search the web for the latest TypeScript release and summarise what changed, with sources.",
    icon: Globe,
    color: "text-sky-500 dark:text-sky-400",
    bg: "bg-sky-500/10 dark:bg-sky-500/20",
  },
  {
    title: "Generate image",
    desc: "App icons, mockups & flat visuals",
    prompt: "Generate an image of a minimalist app icon: a soft cloud with an electric indigo spark, flat design.",
    icon: Sparkles,
    color: "text-purple-500 dark:text-purple-400",
    bg: "bg-purple-500/10 dark:bg-purple-500/20",
  },
  {
    title: "Plan a feature",
    desc: "Step-by-step roadmap & risks",
    prompt: "Plan a migration of this app from Next.js to Vite + lightweight Node server. Break it into concrete steps.",
    icon: ListTodo,
    color: "text-amber-500 dark:text-amber-400",
    bg: "bg-amber-500/10 dark:bg-amber-500/20",
  },
  {
    title: "Tech tradeoffs",
    desc: "Compare databases & libraries",
    prompt: "Should I use SQLite or Postgres for a local-first desktop app? Ask me about my constraints first.",
    icon: Lightbulb,
    color: "text-cyan-500 dark:text-cyan-400",
    bg: "bg-cyan-500/10 dark:bg-cyan-500/20",
  },
];

const MODES: { value: AgentMode; label: string; icon: typeof Bot }[] = [
  { value: "agent", label: "Agent", icon: Bot },
  { value: "plan", label: "Plan", icon: Sparkles },
  { value: "chat", label: "Chat", icon: MessageSquare },
];

export function EmptyState() {
  const sendMessage = useStore((s) => s.sendMessage);
  const settings = useStore((s) => s.settings);
  const openSettings = useStore((s) => s.openSettings);
  const draftMode = useStore((s) => s.draftMode);
  const setDraftMode = useStore((s) => s.setDraftMode);
  const selectedId = useStore((s) => s.selectedId);
  const send = useStore((s) => s.send);
  const conversations = useStore((s) => s.conversations);
  const currentConversation = conversations.find((c) => c.id === selectedId);
  const activeMode = currentConversation?.mode ?? draftMode;

  const auth = useAuth();
  const account = accountFromSession(auth.session);
  const firstName = account?.name ? account.name.trim().split(" ")[0] : null;

  const demo = settings?.provider.kind === "mock" || (settings && !settings.provider.hasApiKey);

  const handleSelectMode = async (m: AgentMode) => {
    if (currentConversation) {
      await send({
        type: "conversation.update",
        conversationId: currentConversation.id,
        patch: { mode: m },
      }).catch(() => {});
    } else {
      setDraftMode(m);
    }
  };

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-start px-3 pt-3 pb-4 sm:px-6 sm:pt-14 sm:pb-8">
      {/* Background ambient lighting */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-96 w-[90vw] max-w-[70rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl dark:bg-primary/15" />
        <div className="absolute top-10 left-[60%] h-64 w-[50vw] max-w-[40rem] -translate-x-1/2 rounded-full bg-chart-2/10 blur-3xl dark:bg-chart-2/15" />
      </div>

      <div className="relative flex w-full max-w-2xl flex-col items-center text-center">
        {/* Mascot hero */}
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 280, damping: 24 }}
          className="relative mb-3 flex items-center justify-center sm:mb-5"
        >
          <div className="relative flex size-14 items-center justify-center rounded-2xl bg-gradient-to-b from-primary/15 to-primary/5 p-2 ring-1 ring-primary/20 shadow-sm shadow-primary/10 sm:size-20 sm:rounded-3xl">
            <NimbusMark size={44} className="sm:hidden" />
            <NimbusMark size={64} className="hidden sm:block" />
          </div>
        </motion.div>

        {/* Heading */}
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, type: "spring", stiffness: 280, damping: 24 }}
          className="text-lg font-semibold tracking-tight text-foreground sm:text-2xl"
        >
          {firstName ? `Ready, ${firstName}` : "What should we build today?"}
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.09, type: "spring", stiffness: 280, damping: 24 }}
          className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground sm:max-w-md sm:text-sm"
        >
          Your workspace runs right here on your computer and syncs to your phone.
        </motion.p>

        {/* Mode selector pills */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, type: "spring", stiffness: 280, damping: 24 }}
          className="mt-3 flex items-center gap-1.5 rounded-full border border-border/80 bg-surface/80 p-1 backdrop-blur-xs sm:mt-4"
        >
          {MODES.map((m) => {
            const active = activeMode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => void handleSelectMode(m.value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground active:scale-95"
                )}
              >
                <m.icon className="size-3.5" />
                <span>{m.label}</span>
              </button>
            );
          })}
        </motion.div>

        {/* Demo mode alert banner */}
        {demo && (
          <motion.button
            type="button"
            onClick={() => openSettings("model")}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-warning/20"
          >
            <span className="size-1.5 rounded-full bg-warning" /> Offline demo mode — add API key in Settings
          </motion.button>
        )}

        {/* Suggestion action cards: Responsive 2-column grid on mobile */}
        <motion.div
          className="mt-4 grid w-full grid-cols-2 gap-2 text-left sm:mt-6 sm:grid-cols-3 sm:gap-3"
          initial="hidden"
          animate="show"
          variants={{
            hidden: {},
            show: { transition: { staggerChildren: 0.04, delayChildren: 0.16 } },
          }}
        >
          {SUGGESTIONS.map((s) => (
            <motion.button
              key={s.title}
              type="button"
              variants={{
                hidden: { opacity: 0, y: 10 },
                show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 320, damping: 26 } },
              }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.96 }}
              onClick={() => void sendMessage(s.prompt)}
              className={cn(
                "group relative flex flex-col justify-between rounded-2xl border border-border/70 bg-surface-raised/90 p-2.5 text-left shadow-xs transition-all",
                "hover:border-primary/40 hover:bg-accent/40 active:bg-accent/60 backdrop-blur-sm sm:p-3.5"
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-xl sm:size-8", s.bg)}>
                  <s.icon className={cn("size-3.5 sm:size-4", s.color)} />
                </span>
                <span className="text-[12px] font-semibold tracking-tight text-foreground sm:text-[13px] leading-tight line-clamp-1">
                  {s.title}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground line-clamp-2 sm:text-xs">
                {s.desc}
              </p>
            </motion.button>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
