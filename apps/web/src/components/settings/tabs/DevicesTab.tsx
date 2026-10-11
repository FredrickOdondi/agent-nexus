import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Laptop, Loader2, LogOut, Monitor, Pencil, QrCode, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@nimbus/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEVICE_NAME_KEY, TOKEN_KEY, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Section } from "../SettingsDialog";

interface Ticket { code: string; url: string; expiresAt: number; qr: string; lanUrls: string[] }

export function DevicesTab() {
  const devices = useStore((s) => s.devices);
  const deviceId = useStore((s) => s.deviceId);
  const send = useStore((s) => s.send);
  const signOut = useStore((s) => s.signOut);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const me = devices.find((d) => d.id === deviceId);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const createTicket = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pair/create", { method: "POST", headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY) ?? ""}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error);
      setTicket((await res.json()) as Ticket);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const remaining = ticket ? Math.max(0, Math.floor((ticket.expiresAt - now) / 1000)) : 0;
  useEffect(() => { if (ticket && remaining === 0) setTicket(null); }, [remaining, ticket]);

  return (
    <div>
      <Section title="Link a phone or another computer" description="Like WhatsApp: scan the QR (or type the code) on the other device. Both must be on the same network, or expose this server via a tunnel.">
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <div className="flex size-56 items-center justify-center rounded-2xl border bg-white p-3 elevation-1 dark:bg-white">
            <AnimatePresence mode="wait">
              {ticket ? (
                <motion.img key={ticket.code} src={ticket.qr} alt={`Pairing QR for code ${ticket.code}`} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="size-full" />
              ) : (
                <motion.button key="placeholder" type="button" onClick={createTicket} disabled={loading} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex size-full flex-col items-center justify-center gap-2 rounded-xl text-neutral-500 transition-colors hover:bg-neutral-100">
                  {loading ? <Loader2 className="size-6 animate-spin" /> : <QrCode className="size-8" />}<span className="text-xs font-medium">Generate QR code</span>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-medium">1. Open Nimbus on the other device</p>
              <p className="text-xs text-muted-foreground">On a phone, scan the QR with the camera — it opens the mobile app in the browser (add it to your home screen for an app-like experience). Or visit {ticket?.lanUrls[0] ? <span className="font-mono">{ticket.lanUrls[0]}</span> : "the LAN address shown on the server"} and enter the code.</p>
            </div>
            <div>
              <p className="text-sm font-medium">2. Enter the 6-digit code</p>
              <div className="mt-1.5 flex items-center gap-3">
                <span className={cn("rounded-xl border bg-surface px-4 py-2 font-mono text-2xl tracking-[0.35em] tabular-nums", !ticket && "text-muted-foreground/40")}>{ticket?.code ?? "······"}</span>
                {ticket && <span className="text-xs text-muted-foreground">expires in {remaining}s</span>}
              </div>
            </div>
            <div className="mt-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={createTicket} disabled={loading}><RefreshCw className={cn(loading && "animate-spin")} /> {ticket ? "New code" : "Generate"}</Button>
              {ticket && <Button variant="ghost" size="sm" onClick={() => { void navigator.clipboard.writeText(ticket.url); toast.success("Link copied"); }}>Copy link</Button>}
            </div>
          </div>
        </div>
      </Section>

      <Section title={`Linked devices (${devices.length})`} description="Messages, settings and agent activity sync live between all of them.">
        <ul className="divide-y rounded-xl border bg-surface">
          {devices.map((d) => (
            <DeviceRow key={d.id} device={d} isMe={d.id === deviceId} onRename={(name) => send({ type: "device.rename", deviceId: d.id, name }).then(() => { if (d.id === deviceId) localStorage.setItem(DEVICE_NAME_KEY, name); }).catch((e) => toast.error((e as Error).message))} onRevoke={() => { if (confirm(`Unlink “${d.name}”? It will be signed out immediately.`)) void send({ type: "device.revoke", deviceId: d.id }).catch((e) => toast.error((e as Error).message)); }} />
          ))}
        </ul>
        {me && !me.primary && (
          <Button variant="outline" size="sm" onClick={() => { if (confirm("Sign out of this device? Local cache will be cleared.")) void signOut(); }}><LogOut /> Sign out this device</Button>
        )}
      </Section>
    </div>
  );
}

function DeviceRow({ device: d, isMe, onRename, onRevoke }: { device: { id: string; name: string; platform: string; primary: boolean; online?: boolean; lastSeenAt: number }; isMe: boolean; onRename: (n: string) => void; onRevoke: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.name);
  const Icon = d.platform === "mobile" ? Smartphone : d.platform === "desktop" ? Laptop : Monitor;
  return (
    <li className="flex items-center gap-3 px-3.5 py-3">
      <span className="relative flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /><span className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface", d.online ? "bg-success" : "bg-muted-foreground/40")} /></span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form onSubmit={(e) => { e.preventDefault(); setEditing(false); if (name.trim() && name.trim() !== d.name) onRename(name.trim()); }}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(false)} className="h-7 text-sm" />
          </form>
        ) : (
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">{d.name}{isMe && <Badge variant="secondary" className="h-4 px-1 text-[10px]">this device</Badge>}{d.primary && <Badge variant="outline" className="h-4 px-1 text-[10px]">host</Badge>}</p>
        )}
        <p className="text-xs text-muted-foreground">{d.online ? "Online now" : `Last seen ${formatRelative(d.lastSeenAt)} ago`} · {d.platform}</p>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={() => { setName(d.name); setEditing(true); }} aria-label="Rename"><Pencil /></Button>
      {!d.primary && <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={onRevoke} aria-label="Unlink"><Trash2 /></Button>}
    </li>
  );
}
