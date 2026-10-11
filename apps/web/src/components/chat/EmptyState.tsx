import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Code2, Globe, ListTodo, Sparkles, Terminal, Wand2 } from "lucide-react";
import { useStore } from "@/lib/store";

const SUGGESTIONS = [
  { icon: Code2, title: "Explore the codebase", prompt: "Explore the codebase and summarise the architecture, key modules and how they fit together." },
  { icon: Globe, title: "Research with sources", prompt: "Search the web for the latest TypeScript release and summarise what changed, with sources." },
  { icon: Terminal, title: "Run and fix", prompt: "Run the test suite, read any failures, fix them and re-run until green." },
  { icon: ListTodo, title: "Plan a migration", prompt: "Plan a migration of this app from Next.js to Vite + a lightweight Node server. Break it into concrete steps." },
  { icon: Wand2, title: "Generate an image", prompt: "Generate an image of a minimalist app icon: a soft cloud with an electric indigo spark, flat design." },
  { icon: Sparkles, title: "Ask me to decide", prompt: "Should I use SQLite or Postgres for a local-first desktop app? Ask me about my constraints first." },
];

export function EmptyState() {
  const sendMessage = useStore((s) => s.sendMessage);
  const settings = useStore((s) => s.settings);
  const openSettings = useStore((s) => s.openSettings);
  const demo = settings?.provider.kind === "mock" || (settings && !settings.provider.hasApiKey);

  return (
    <div className="relative mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-start px-4 py-6 sm:justify-center sm:px-6 sm:py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <motion.div className="absolute top-[12%] left-[18%] size-72 rounded-full bg-primary/15 blur-3xl" animate={{ x: [0, 30, 0], y: [0, -20, 0] }} transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div className="absolute right-[12%] bottom-[18%] size-80 rounded-full bg-chart-2/15 blur-3xl" animate={{ x: [0, -24, 0], y: [0, 26, 0] }} transition={{ duration: 17, repeat: Infinity, ease: "easeInOut" }} />
      </div>

      <motion.div initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 26 }} className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-chart-2 text-xl font-bold text-primary-foreground elevation-3 animate-float">
        N
      </motion.div>
      <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, type: "spring", stiffness: 260, damping: 26 }} className="text-center text-xl font-semibold tracking-tight sm:text-3xl">
        What should we build today?
      </motion.h1>
      <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 26 }} className="mt-2 max-w-md text-center text-sm text-muted-foreground">
        Nimbus reads and edits files, runs commands, searches the web, spawns subagents and remembers across sessions — synced live to every linked device.
      </motion.p>

      {demo && (
        <motion.button
          type="button"
          onClick={() => openSettings("model")}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-warning/20"
        >
          <span className="size-1.5 rounded-full bg-warning" /> Offline demo mode — add a DeepSeek API key in Settings
        </motion.button>
      )}

      <motion.div
        className="mt-8 grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-3"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.15 } } }}
      >
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s.title}
            type="button"
            variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 26 } } }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => void sendMessage(s.prompt)}
            className={cn("group flex min-h-14 items-start gap-3 rounded-2xl border bg-surface-raised p-3.5 text-left elevation-1 transition-colors hover:border-primary/40 hover:bg-accent/40 active:scale-[0.99]", i > 2 && "max-lg:hidden")}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary"><s.icon className="size-4" /></span>
            <span className="min-w-0"><span className="block text-sm font-medium">{s.title}</span><span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{s.prompt}</span></span>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}
