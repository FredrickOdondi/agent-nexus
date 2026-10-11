import { motion } from "motion/react";
import { NimbusMark } from "@/components/brand/NimbusMark";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store";

const SUGGESTIONS = [
  { title: "Explore the codebase", prompt: "Explore the codebase and summarise the architecture, key modules and how they fit together." },
  { title: "Research with sources", prompt: "Search the web for the latest TypeScript release and summarise what changed, with sources." },
  { title: "Run and fix", prompt: "Run the test suite, read any failures, fix them and re-run until green." },
  { title: "Plan a migration", prompt: "Plan a migration of this app from Next.js to Vite + a lightweight Node server. Break it into concrete steps." },
  { title: "Generate an image", prompt: "Generate an image of a minimalist app icon: a soft cloud with an electric indigo spark, flat design." },
  { title: "Ask me to decide", prompt: "Should I use SQLite or Postgres for a local-first desktop app? Ask me about my constraints first." },
];

export function EmptyState() {
  const sendMessage = useStore((s) => s.sendMessage);
  const settings = useStore((s) => s.settings);
  const openSettings = useStore((s) => s.openSettings);
  const demo = settings?.provider.kind === "mock" || (settings && !settings.provider.hasApiKey);

  return (
    <div className="relative mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-start px-4 py-6 sm:justify-center sm:px-6 sm:py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(ellipse_at_50%_-10%,var(--primary),transparent_58%)] opacity-[0.14]" />
        <div className="absolute inset-x-[8%] top-8 h-72 bg-[radial-gradient(ellipse_at_72%_0%,var(--chart-2),transparent_62%)] opacity-[0.18]" />
      </div>

      <motion.div initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 26 }} className="mb-6">
        <NimbusMark size={72} />
      </motion.div>
      <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05, type: "spring", stiffness: 260, damping: 26 }} className="text-center text-xl font-semibold tracking-tight sm:text-3xl">
        What should we build today?
      </motion.h1>
      <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 26 }} className="mt-2 max-w-md text-center text-sm text-muted-foreground">
        Your chats stay on this computer and sync to every linked phone.
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
        className="-mx-4 mt-8 flex w-[calc(100%+2rem)] snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:w-full sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 [&::-webkit-scrollbar]:hidden"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.15 } } }}
      >
        {SUGGESTIONS.map((s) => (
          <motion.button
            key={s.title}
            type="button"
            variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 26 } } }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => void sendMessage(s.prompt)}
            className={cn("group flex w-[min(78vw,240px)] shrink-0 snap-start items-center gap-3 rounded-2xl border bg-surface-raised p-3.5 text-left elevation-1 transition-colors hover:border-primary/40 hover:bg-accent/40 active:scale-[0.99] sm:w-auto")}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10"><NimbusMark state="static" size={22} /></span>
            <span className="text-sm font-medium">{s.title}</span>
          </motion.button>
        ))}
      </motion.div>
    </div>
  );
}
