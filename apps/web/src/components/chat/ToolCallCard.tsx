import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Bot,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  Cloud,
  FileCode2,
  FileEdit,
  FolderTree,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Lock,
  Search,
  ShieldAlert,
  Sparkles,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import type { ToolCallPart, ToolDisplay } from "@nimbus/shared";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const ICONS: Record<string, typeof Terminal> = {
  run_terminal_cmd: Terminal,
  read_file: FileCode2,
  write_file: FileEdit,
  search_replace: FileEdit,
  list_dir: FolderTree,
  glob: Search,
  grep: Search,
  web_search: Globe,
  web_fetch: Globe,
  x_search: Globe,
  code_execution: Cloud,
  todo_write: ListChecks,
  task: Bot,
  get_task_output: Bot,
  memory: Brain,
  enter_plan_mode: Sparkles,
  exit_plan_mode: Sparkles,
  skill: Sparkles,
  image_gen: ImageIcon,
};

function headline(part: ToolCallPart): string {
  const a = part.args ?? {};
  switch (part.name) {
    case "run_terminal_cmd": return String(a.command ?? "");
    case "read_file": case "write_file": case "search_replace": return String(a.path ?? "");
    case "list_dir": return String(a.path ?? ".");
    case "glob": return String(a.pattern ?? "");
    case "grep": return String(a.pattern ?? "");
    case "web_search": case "x_search": return String(a.query ?? "");
    case "web_fetch": return String(a.url ?? "");
    case "task": return `${a.subagent_type ?? "agent"} · ${a.description ?? ""}`;
    case "todo_write": return `${(a.todos as unknown[] | undefined)?.length ?? 0} tasks`;
    case "memory": return `${a.action ?? "read"} ${a.scope ?? "workspace"}`;
    case "skill": return String(a.name ?? "");
    case "image_gen": return String(a.prompt ?? "");
    default: {
      const first = Object.values(a).find((v) => typeof v === "string");
      return first ? String(first) : "";
    }
  }
}

function StatusIcon({ status }: { status: ToolCallPart["status"] }) {
  switch (status) {
    case "running": case "pending": return <Loader2 className="size-3.5 animate-spin text-primary" />;
    case "awaiting_approval": return <Lock className="size-3.5 text-warning" />;
    case "complete": return <Check className="size-3.5 text-success" />;
    case "error": return <CircleAlert className="size-3.5 text-destructive" />;
    case "denied": return <ShieldAlert className="size-3.5 text-destructive" />;
    case "cancelled": return <X className="size-3.5 text-muted-foreground" />;
  }
}

export function ToolCallCard({ part, defaultOpen = false }: { part: ToolCallPart; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = ICONS[part.name] ?? Wrench;
  const title = headline(part);
  const duration = part.startedAt && part.endedAt ? Math.max(0, part.endedAt - part.startedAt) : null;
  const expandable = Boolean(part.display || part.result || part.error);

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className={cn(
        "my-1.5 overflow-hidden rounded-xl border bg-surface text-sm elevation-1",
        part.status === "awaiting_approval" && "border-warning/50",
        part.status === "error" && "border-destructive/40",
      )}
    >
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left", expandable && "hover:bg-muted/50")}
        aria-expanded={open}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="shrink-0 font-medium">{part.title}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{title}</span>
        </span>
        {part.serverSide && <Badge variant="secondary" className="hidden h-5 px-1.5 text-[10px] sm:inline-flex">xAI</Badge>}
        {duration !== null && <span className="hidden text-[11px] tabular-nums text-muted-foreground sm:inline">{duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}</span>}
        <StatusIcon status={part.status} />
        {expandable && <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform duration-200", open && "rotate-90")} />}
      </button>
      <AnimatePresence initial={false}>
        {open && expandable && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t px-3 py-2.5">
              <ToolBody part={part} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ToolBody({ part }: { part: ToolCallPart }) {
  const d = part.display;
  if (part.status === "denied" || (part.error && !d)) {
    return <p className="text-xs text-destructive">{part.error ?? part.result}</p>;
  }
  if (!d) return <pre className="max-h-72 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">{part.result}</pre>;
  return <Display display={d} status={part.status} />;
}

function Display({ display, status }: { display: ToolDisplay; status: ToolCallPart["status"] }) {
  switch (display.kind) {
    case "terminal":
      return (
        <div>
          <div className="mb-1.5 flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span className="truncate">{display.cwd}</span>
            {display.exitCode !== null && <Badge variant={display.exitCode === 0 ? "secondary" : "destructive"} className="h-4 px-1 text-[10px]">exit {display.exitCode}</Badge>}
            {status === "running" && <span className="text-primary">running…</span>}
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg bg-[var(--code-bg)] p-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap">{display.output || (status === "running" ? "…" : "(no output)")}</pre>
        </div>
      );
    case "diff":
      return <DiffView before={display.before} after={display.after} />;
    case "file":
      return <pre className="max-h-80 overflow-auto rounded-lg bg-[var(--code-bg)] p-2.5 font-mono text-xs leading-relaxed">{display.content}</pre>;
    case "list":
      return <pre className="max-h-72 overflow-auto font-mono text-xs leading-relaxed text-muted-foreground">{display.entries.join("\n") || "(empty)"}</pre>;
    case "search":
      return (
        <ol className="space-y-2">
          {display.results.map((r, i) => (
            <li key={i} className="text-xs">
              <a href={r.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{r.title || r.url}</a>
              <p className="mt-0.5 line-clamp-2 text-muted-foreground">{r.snippet}</p>
            </li>
          ))}
          {display.results.length === 0 && <li className="text-xs text-muted-foreground">No results.</li>}
        </ol>
      );
    case "fetch":
      return (
        <div className="text-xs">
          <a href={display.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{display.title}</a>
          <p className="mt-1 text-muted-foreground">{display.excerpt}</p>
        </div>
      );
    case "todos":
      return (
        <ul className="space-y-1.5">
          {display.todos.map((t) => (
            <li key={t.id} className="flex items-start gap-2 text-xs">
              <span className={cn("mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border", t.status === "completed" && "border-success bg-success text-white", t.status === "in_progress" && "border-primary", t.status === "cancelled" && "opacity-40")}>
                {t.status === "completed" && <Check className="size-2.5" />}
                {t.status === "in_progress" && <span className="size-1.5 rounded-full bg-primary animate-pulse-soft" />}
              </span>
              <span className={cn(t.status === "completed" && "text-muted-foreground line-through", t.status === "cancelled" && "line-through opacity-50")}>{t.content}</span>
            </li>
          ))}
        </ul>
      );
    case "task":
      return (
        <div className="text-xs">
          <div className="flex items-center gap-2"><Badge variant="secondary" className="h-5 text-[10px]">{display.subagent}</Badge><span className="font-medium">{display.summary}</span><span className="text-muted-foreground">· {display.status}</span></div>
        </div>
      );
    case "memory":
      return <pre className="max-h-60 overflow-auto font-mono text-xs whitespace-pre-wrap text-muted-foreground">{display.text || "(empty)"}</pre>;
    case "image":
      return <img src={display.url} alt={display.prompt} className="max-h-80 rounded-lg" loading="lazy" />;
    case "plan":
      return display.plan ? <pre className="max-h-80 overflow-auto text-xs whitespace-pre-wrap">{display.plan}</pre> : <p className="text-xs text-muted-foreground">Plan mode {display.mode === "enter" ? "entered" : "exited"}.</p>;
    case "generic":
      return <pre className="max-h-60 overflow-auto font-mono text-xs whitespace-pre-wrap">{display.text}</pre>;
  }
}

function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => simpleDiff(before.split("\n"), after.split("\n")), [before, after]);
  const added = lines.filter((l) => l.t === "+").length;
  const removed = lines.filter((l) => l.t === "-").length;
  return (
    <div>
      <div className="mb-1.5 flex gap-2 font-mono text-[11px]"><span className="text-success">+{added}</span><span className="text-destructive">−{removed}</span></div>
      <pre className="max-h-96 overflow-auto rounded-lg bg-[var(--code-bg)] font-mono text-xs leading-relaxed">
        {lines.slice(0, 400).map((l, i) => (
          <div key={i} className={cn("px-2.5", l.t === "+" && "bg-success/12 text-success", l.t === "-" && "bg-destructive/10 text-destructive", l.t === " " && "text-muted-foreground")}>
            <span className="mr-2 select-none opacity-60">{l.t}</span>{l.s}
          </div>
        ))}
        {lines.length > 400 && <div className="px-2.5 text-muted-foreground">… {lines.length - 400} more lines</div>}
      </pre>
    </div>
  );
}

/** LCS-based line diff with context collapsing; good enough for tool output previews. */
function simpleDiff(a: string[], b: string[]): { t: " " | "+" | "-"; s: string }[] {
  const n = a.length, m = b.length;
  if (n * m > 400_000) {
    return [...a.map((s) => ({ t: "-" as const, s })), ...b.map((s) => ({ t: "+" as const, s }))];
  }
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: " " | "+" | "-"; s: string }[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ t: " ", s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "-", s: a[i] }); i++; }
    else { out.push({ t: "+", s: b[j] }); j++; }
  }
  while (i < n) out.push({ t: "-", s: a[i++] });
  while (j < m) out.push({ t: "+", s: b[j++] });
  // collapse long unchanged runs to 3 lines of context
  const collapsed: typeof out = [];
  let run: typeof out = [];
  const flush = (last: boolean) => {
    if (run.length > 7) {
      collapsed.push(...run.slice(0, 3));
      collapsed.push({ t: " ", s: `… ${run.length - 6} unchanged lines …` });
      if (!last) collapsed.push(...run.slice(-3));
    } else collapsed.push(...run);
    run = [];
  };
  for (const l of out) {
    if (l.t === " ") run.push(l);
    else { flush(false); collapsed.push(l); }
  }
  flush(true);
  return collapsed;
}
