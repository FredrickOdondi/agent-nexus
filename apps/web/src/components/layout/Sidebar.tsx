import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Settings, ShieldCheck, Smartphone, SquarePen, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { ClientCommand, Conversation } from "@nimbus/shared";
import { formatRelative } from "@nimbus/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth";
import { accountFromSession } from "@/lib/supabase";
import { useStore } from "@/lib/store";
import { isElectron, isMac } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { NimbusMark } from "@/components/brand/NimbusMark";
import { ThemeToggle } from "./ThemeToggle";
import { InstallHint } from "./InstallHint";

export function Sidebar({ onNavigate, variant = "sidebar" }: { onNavigate?: () => void; variant?: "sidebar" | "inbox" }) {
  const conversations = useStore((s) => s.conversations);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const newChat = useStore((s) => s.newChat);
  const openSettings = useStore((s) => s.openSettings);
  const runs = useStore((s) => s.runs);
  const devices = useStore((s) => s.devices);
  const connection = useStore((s) => s.connection);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)) : conversations;
  }, [conversations, query]);

  const groups = useMemo(() => groupByDate(filtered), [filtered]);
  const approvals = useStore((s) => s.approvals);
  const account = accountFromSession(useAuth().session);
  const onlineDevices = devices.filter((d) => d.online).length;
  const inbox = variant === "inbox";
  const statusLabel = connection === "online" ? `${onlineDevices} online` : connection === "connecting" ? "Connecting…" : "Offline";

  return (
    <aside className={cn("flex h-full w-full flex-col text-sidebar-foreground", inbox ? "bg-background" : "bg-sidebar")}>
      {inbox ? (
        <div className="px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
          <div className="flex items-end gap-2">
            <div className="min-w-0">
              <h1 className="text-[32px] leading-none font-semibold tracking-tight text-foreground">Chats</h1>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("size-1.5 rounded-full", connection === "online" ? "bg-success" : connection === "connecting" ? "bg-warning animate-pulse" : "bg-destructive")} />
                {statusLabel}
              </p>
            </div>
            <div className="mb-0.5 ml-auto flex items-center gap-1">
              <ThemeToggle />
              <Button size="icon" className="size-11 rounded-full" onClick={() => { newChat(); onNavigate?.(); }} aria-label="New chat"><SquarePen /></Button>
            </div>
          </div>
        </div>
      ) : (
        <div className={cn("flex items-center gap-2 px-3 pt-3 pb-2", isElectron && isMac && "drag-region pt-10")}>
          <NimbusMark size={28} />
          <span className="font-semibold tracking-tight">Nimbus</span>
          <span className={cn("ml-1 size-1.5 rounded-full", connection === "online" ? "bg-success" : connection === "connecting" ? "bg-warning animate-pulse" : "bg-destructive")} title={connection} />
          <div className="ml-auto flex items-center gap-0.5 no-drag">
            <ThemeToggle />
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={() => { newChat(); onNavigate?.(); }} aria-label="New chat" />}><SquarePen /></TooltipTrigger>
              <TooltipContent>New chat</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      <div className={cn("px-3 pb-2", inbox && "px-4")}>
        <div className="relative">
          <Search className={cn("pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground", inbox && "left-3 size-4")} />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" className={cn("h-8 bg-sidebar-accent/60 pl-8 text-sm", inbox && "h-11 rounded-xl bg-muted pl-9 text-base")} />
          {query && <button type="button" onClick={() => setQuery("")} className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear"><X className="size-4" /></button>}
        </div>
      </div>
      {inbox && <InstallHint />}
      {inbox && approvals[0] && (
        <button type="button" onClick={() => { select(approvals[0].conversationId); onNavigate?.(); }} className="mx-4 mb-2 flex items-center gap-3 rounded-2xl bg-warning/15 px-3 py-3 text-left active:opacity-80">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning"><ShieldCheck className="size-4" /></span>
          <span className="min-w-0"><span className="block text-sm font-medium text-foreground">Nimbus needs permission</span><span className="block truncate text-xs text-muted-foreground">{approvals[0].title}</span></span>
        </button>
      )}

      <nav className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2", inbox && "px-2")} aria-label="Conversations">
        {conversations.length === 0 && (
          <div className="px-3 py-10 text-center">
            <p className="text-sm font-medium">No chats yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Start a conversation and it will sync to every linked device.</p>
            <Button size="sm" className="mt-4" onClick={() => { newChat(); onNavigate?.(); }}><Plus /> New chat</Button>
          </div>
        )}
        {conversations.length > 0 && filtered.length === 0 && <p className="px-3 py-8 text-center text-xs text-muted-foreground">No chats match “{query}”.</p>}
        {groups.map((g) => (
          <div key={g.label} className="mb-2">
            <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{g.label}</p>
            <AnimatePresence initial={false}>
              {g.items.map((c) => (
                <ConversationRow key={c.id} conversation={c} active={c.id === selectedId} running={Boolean(runs[c.id])} roomy={inbox} onSelect={() => { select(c.id); onNavigate?.(); }} />
              ))}
            </AnimatePresence>
          </div>
        ))}
      </nav>

      <div className={cn("border-t border-sidebar-border p-2", inbox && "safe-bottom bg-background px-3")}>
        {account && (
          <button type="button" onClick={() => openSettings("account")} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent active:bg-sidebar-accent", inbox && "min-h-12 rounded-xl")}>
            {account.avatar ? <img src={account.avatar} alt="" className="size-7 shrink-0 rounded-full object-cover" /> : <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{account.name.slice(0, 1).toUpperCase()}</span>}
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{account.name}</span><span className="block truncate text-xs text-muted-foreground">{account.email || "Google account"}</span></span>
          </button>
        )}
        <button type="button" onClick={() => openSettings("devices")} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent active:bg-sidebar-accent", inbox && "min-h-12 rounded-xl")}>
          <span className="relative flex size-7 items-center justify-center rounded-lg bg-sidebar-accent text-muted-foreground"><Smartphone className="size-4" />{onlineDevices > 1 && <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-success ring-2 ring-sidebar" />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">Linked devices</span><span className="block truncate text-xs text-muted-foreground">{devices.length} device{devices.length === 1 ? "" : "s"} · {onlineDevices} online</span></span>
        </button>
        <button type="button" onClick={() => openSettings()} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent active:bg-sidebar-accent", inbox && "min-h-12 rounded-xl")}>
          <span className="flex size-7 items-center justify-center rounded-lg bg-sidebar-accent text-muted-foreground"><Settings className="size-4" /></span>
          <span className="font-medium">Settings</span>
        </button>
      </div>
    </aside>
  );
}

function ConversationRow({ conversation: c, active, running, roomy, onSelect }: { conversation: Conversation; active: boolean; running: boolean; roomy?: boolean; onSelect: () => void }) {
  const send = useStore((s) => s.send);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(c.title);

  const update = (patch: Extract<ClientCommand, { type: "conversation.update" }>["patch"]) =>
    send({ type: "conversation.update", conversationId: c.id, patch }).catch((e) => toast.error((e as Error).message));
  const remove = () => {
    if (!confirm(`Delete “${c.title}”? This removes it from all devices.`)) return;
    send({ type: "conversation.delete", conversationId: c.id }).catch((e) => toast.error((e as Error).message));
  };

  return (
    <motion.div layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8, height: 0 }} transition={{ type: "spring", stiffness: 420, damping: 34 }} className="group relative">
      {renaming ? (
        <form
          className="px-1 py-0.5"
          onSubmit={(e) => {
            e.preventDefault();
            setRenaming(false);
            if (title.trim() && title.trim() !== c.title) void update({ title: title.trim().slice(0, 80) });
          }}
        >
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => setRenaming(false)} className="h-8 text-sm" />
        </form>
      ) : (
        <button
          type="button"
          onClick={onSelect}
          className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors select-none active:bg-sidebar-accent", roomy && "min-h-[4.25rem] items-center gap-3 rounded-2xl px-3 py-2.5 pr-12", active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/60")}
        >
          {active && !roomy && <motion.span layoutId="active-pill" className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-primary" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
          {roomy && <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{(c.title.trim()[0] ?? "N").toUpperCase()}</span>}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {c.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
              <span className={cn("truncate font-medium", roomy ? "text-[16px]" : "text-sm")}>{c.title}</span>
              {running && <span className="relative ml-auto flex size-1.5 shrink-0"><span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-70" /><span className="relative inline-flex size-1.5 rounded-full bg-primary" /></span>}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="truncate">{c.preview || "No messages yet"}</span>
              <span className="ml-auto shrink-0 tabular-nums">{formatRelative(c.updatedAt)}</span>
            </span>
          </span>
        </button>
      )}
      {!renaming && (
        <div className={cn("absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100", roomy ? "top-1/2 right-2 -translate-y-1/2 opacity-100" : "[@media(hover:none)]:opacity-100")}>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size={roomy ? "icon-sm" : "icon-xs"} className={cn(!roomy && "bg-sidebar/80 backdrop-blur")} aria-label="Chat options" />}><MoreHorizontal /></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => void update({ pinned: !c.pinned })}>{c.pinned ? <PinOff /> : <Pin />} {c.pinned ? "Unpin" : "Pin"}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setTitle(c.title); setRenaming(true); }}><Pencil /> Rename</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={remove}><Trash2 /> Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </motion.div>
  );
}

function groupByDate(list: Conversation[]): { label: string; items: Conversation[] }[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets: Record<string, Conversation[]> = {};
  const order = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];
  for (const c of list) {
    const label = c.pinned ? "Pinned" : c.updatedAt >= startOfToday ? "Today" : c.updatedAt >= startOfToday - 86_400_000 ? "Yesterday" : c.updatedAt >= startOfToday - 7 * 86_400_000 ? "Previous 7 days" : c.updatedAt >= startOfToday - 30 * 86_400_000 ? "Previous 30 days" : "Older";
    (buckets[label] ??= []).push(c);
  }
  return order.filter((l) => buckets[l]?.length).map((l) => ({ label: l, items: buckets[l] }));
}
