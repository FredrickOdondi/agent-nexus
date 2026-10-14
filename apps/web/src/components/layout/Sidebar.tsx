import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Bot, ChevronDown, Crown, MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Settings, ShieldCheck, Smartphone, Sparkles, SquarePen, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { ClientCommand, Conversation, SubagentInfo } from "@nimbus/shared";
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
import { SubagentAvatar } from "@/components/brand/ChatAvatar";
import { ThemeToggle } from "./ThemeToggle";
import { InstallHint } from "./InstallHint";
import { SubagentModal } from "@/components/subagents/SubagentModal";

export function Sidebar({ onNavigate, variant = "sidebar" }: { onNavigate?: () => void; variant?: "sidebar" | "inbox" }) {
  const conversations = useStore((s) => s.conversations);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const newChat = useStore((s) => s.newChat);
  const openSettings = useStore((s) => s.openSettings);
  const runs = useStore((s) => s.runs);
  const devices = useStore((s) => s.devices);
  const connection = useStore((s) => s.connection);
  const subagents = useStore((s) => s.subagents);
  const upsertSubagent = useStore((s) => s.upsertSubagent);
  const deleteSubagent = useStore((s) => s.deleteSubagent);
  const subscription = useStore((s) => s.subscription);
  const openUpgradeModal = useStore((s) => s.openUpgradeModal);
  const [query, setQuery] = useState("");
  const [subagentsOpen, setSubagentsOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedSubagent, setSelectedSubagent] = useState<SubagentInfo | null>(null);
  const [isNewSubagent, setIsNewSubagent] = useState(false);

  const isLifetime = Boolean(
    subscription?.billingInterval === "lifetime" ||
    subscription?.planName?.toLowerCase().includes("lifetime") ||
    subscription?.licenseKey?.toUpperCase().includes("LIFE")
  );
  const isPro = subscription?.tier === "pro";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? conversations.filter((c) => c.title.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q)) : conversations;
  }, [conversations, query]);

  const filteredSubagents = useMemo(() => {
    const localOnly = subagents.filter((s) => s.scope !== "builtin");
    const q = query.trim().toLowerCase();
    return q
      ? localOnly.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q)
        )
      : localOnly;
  }, [subagents, query]);

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
        {/* Subagents Section */}
        <div className="mb-3 px-1">
          <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <button
              type="button"
              onClick={() => setSubagentsOpen(!subagentsOpen)}
              className="flex items-center gap-1.5 hover:text-foreground transition-colors select-none"
            >
              <Bot className="size-3.5 text-primary" />
              <span>Subagents</span>
              <span className="rounded-full bg-sidebar-accent px-1.5 py-0.2 text-[10px] font-mono text-foreground font-normal">
                {filteredSubagents.length}
              </span>
              <ChevronDown className={cn("size-3 transition-transform", !subagentsOpen && "-rotate-90")} />
            </button>
            <Tooltip>
              <TooltipTrigger render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    const customCount = subagents.filter((s) => s.scope !== "builtin").length;
                    const isPro = subscription?.tier === "pro";
                    if (!isPro && customCount >= (subscription?.limits.maxSubagents ?? 2)) {
                      openUpgradeModal("You've reached the Free limit of 2 custom subagents. Upgrade to Pro for unlimited subagents!");
                      return;
                    }
                    setSelectedSubagent(null);
                    setIsNewSubagent(true);
                    setModalOpen(true);
                  }}
                  aria-label="New subagent"
                >
                  <Plus className="size-3.5" />
                </Button>
              } />
              <TooltipContent>Create custom subagent</TooltipContent>
            </Tooltip>
          </div>

          {subagentsOpen && (
            <div className="mt-0.5 space-y-0.5">
              {filteredSubagents.length === 0 ? (
                <div className="px-2 py-1.5 text-[11px] text-muted-foreground/70 italic">
                  {query ? `No subagents match “${query}”` : "No subagents created yet"}
                </div>
              ) : (
                filteredSubagents.map((sa) => (
                  <div
                    key={sa.name}
                    className="group relative flex items-center justify-between rounded-xl px-2.5 py-2 hover:bg-sidebar-accent/60 transition-colors select-none text-left"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedSubagent(sa);
                        setIsNewSubagent(false);
                        setModalOpen(true);
                      }}
                      className="flex flex-1 min-w-0 items-center gap-3"
                    >
                      <SubagentAvatar seed={sa.avatar || sa.name} avatar={sa.avatar} size={inbox ? 44 : 38} className="shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground truncate">
                            {sa.name}
                          </span>
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.2 text-[9px] font-semibold uppercase tracking-wider shrink-0",
                              sa.scope === "builtin"
                                ? "bg-muted text-muted-foreground"
                                : "bg-primary/15 text-primary"
                            )}
                          >
                            {sa.scope ?? "custom"}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {sa.description}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity ml-1">
                      <Tooltip>
                        <TooltipTrigger render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            className="size-6 text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setSelectedSubagent(sa);
                              setIsNewSubagent(false);
                              setModalOpen(true);
                            }}
                            aria-label="Edit subagent prompt"
                          >
                            <Pencil className="size-3" />
                          </Button>
                        } />
                        <TooltipContent>Edit prompt</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

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

        <button
          type="button"
          onClick={() => openSettings("subscription")}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent active:bg-sidebar-accent",
            inbox && "min-h-12 rounded-xl"
          )}
        >
          <span className={cn(
            "flex size-7 items-center justify-center rounded-lg",
            isLifetime
              ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
              : isPro
              ? "bg-primary/15 text-primary"
              : "bg-sidebar-accent text-muted-foreground"
          )}>
            {isLifetime ? <Crown className="size-4" /> : <Sparkles className="size-4" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate font-medium">
                {isLifetime
                  ? "Lifetime Pass"
                  : subscription?.planName || (isPro ? "Nimbus Pro" : "Free Plan")}
              </span>
              <span className={cn(
                "rounded px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider",
                isLifetime
                  ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 font-extrabold"
                  : isPro
                    ? subscription?.status === "trialing"
                      ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                      : "bg-primary/20 text-primary"
                    : "bg-muted-foreground/15 text-muted-foreground"
              )}>
                {isLifetime
                  ? "LIFETIME"
                  : isPro
                    ? subscription?.status === "trialing"
                      ? `${Math.max(0, Math.ceil(((subscription?.trialExpiresAt ?? 0) - Date.now()) / (1000 * 60 * 60 * 24)))}d left`
                      : "PRO"
                    : "Upgrade"}
              </span>
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {isLifetime
                ? "Lifetime access active"
                : isPro
                  ? subscription?.status === "trialing" ? "14-day Pro trial" : "All features unlocked"
                  : "Free BYOK tier"}
            </span>
          </span>
        </button>

        <button type="button" onClick={() => openSettings()} className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent active:bg-sidebar-accent", inbox && "min-h-12 rounded-xl")}>
          <span className="flex size-7 items-center justify-center rounded-lg bg-sidebar-accent text-muted-foreground"><Settings className="size-4" /></span>
          <span className="font-medium">Settings</span>
        </button>
      </div>

      <SubagentModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        subagent={selectedSubagent}
        isNew={isNewSubagent}
        onSave={async (data) => {
          await upsertSubagent(data);
        }}
        onDelete={async (name) => {
          await deleteSubagent(name);
        }}
        onStartChat={(name) => {
          newChat();
          onNavigate?.();
          toast.info(`Ready to chat with /${name}. Type your task in the message input.`);
        }}
      />
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
          aria-current={active ? "true" : undefined}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors select-none active:bg-sidebar-accent",
            roomy && "min-h-[3.75rem] rounded-2xl px-3 py-2.5 pr-12",
            active ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium" : "hover:bg-sidebar-accent/60 text-muted-foreground hover:text-foreground"
          )}
        >
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              {c.pinned && <Pin className="size-3 shrink-0 text-muted-foreground" />}
              <span className={cn("truncate font-medium text-foreground", roomy ? "text-[15px]" : "text-sm")}>{c.title}</span>
              <span className={cn("ml-auto shrink-0 text-[11px] tabular-nums", running ? "font-medium text-primary" : "text-muted-foreground")}>{running ? "typing…" : formatRelative(c.updatedAt)}</span>
            </span>
            <span className={cn("mt-0.5 block truncate text-muted-foreground", roomy ? "text-xs" : "text-xs")}>{c.preview || "No messages yet"}</span>
          </span>
        </button>
      )}
      {!renaming && (
        <div className={cn("absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100", roomy ? "opacity-100" : "[@media(hover:none)]:opacity-100")}>
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
