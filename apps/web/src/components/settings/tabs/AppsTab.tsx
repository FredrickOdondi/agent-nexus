import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, KeyRound, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import type { ComposioAppState, ComposioKeySource } from "@nimbus/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TOKEN_KEY, useStore } from "@/lib/store";
import { openExternal } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Field, Section, ToggleRow } from "../SettingsDialog";

interface AppsResponse {
  configured: boolean;
  enabled: boolean;
  keySource: ComposioKeySource;
  apps: ComposioAppState[];
  error?: string;
}

async function authed(path: string, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem(TOKEN_KEY) ?? "";
  return fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init?.headers } });
}

export function AppsTab() {
  const settings = useStore((s) => s.settings);
  const send = useStore((s) => s.send);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [apps, setApps] = useState<AppsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authed("/api/composio/apps");
      const body = (await res.json()) as AppsResponse & { error?: string };
      if (!res.ok) throw new Error(body.error || "Could not load apps");
      setApps(body);
    } catch (error) {
      setApps(null);
      toast.error(error instanceof Error ? error.message : "Could not load apps");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, settings?.hasComposioApiKey, settings?.composioEnabled, settings?.composioKeySource]);
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [load]);

  if (!settings) return null;
  const source = settings.composioKeySource ?? (settings.hasComposioApiKey ? "settings" : "none");
  const enabled = settings.composioEnabled !== false;

  const saveKey = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      toast.error("Paste a Composio API key first");
      return;
    }
    setSaving(true);
    try {
      await send({ type: "settings.update", patch: { composioApiKey: trimmed, composioEnabled: true } });
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      toast.success("Composio key saved on this computer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    try {
      await send({ type: "settings.update", patch: { composioApiKey: "" } });
      toast.success("Saved Composio key removed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the key");
    }
  };

  const connect = async (toolkit: string) => {
    const slug = toolkit.trim().toLowerCase();
    if (!slug) return;
    setBusy(slug);
    try {
      const res = await authed("/api/composio/connect", { method: "POST", body: JSON.stringify({ toolkit: slug }) });
      const body = (await res.json()) as { redirectUrl?: string; error?: string };
      if (!res.ok || !body.redirectUrl) throw new Error(body.error || "No connect link was returned");
      openExternal(body.redirectUrl);
      toast.success("Finish connecting in the browser, then come back here");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not connect");
    } finally {
      setBusy(null);
    }
  };

  const list = apps?.apps ?? [];
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? list.filter((app) => app.name.toLowerCase().includes(needle) || app.slug.includes(needle) || app.blurb.toLowerCase().includes(needle) || (app.category ?? "").toLowerCase().includes(needle))
    : list;
  const connectedApps = filtered.filter((app) => app.connected);
  const available = filtered.filter((app) => !app.connected);
  const groups = groupApps(available);

  return (
    <div>
      <Section title="Connected apps" description="The agent can use the accounts you link. The key stays on this computer.">
        <ToggleRow
          label="Let the agent use connected apps"
          hint="Turn this off to hide app tools. Linked accounts stay saved."
          checked={enabled}
          onChange={(value) => void send({ type: "settings.update", patch: { composioEnabled: value } }).catch((error) => toast.error((error as Error).message))}
        />
        <Field label="Composio API key" hint={source === "env" ? "Using COMPOSIO_API_KEY from the environment. A key saved here replaces it." : source === "settings" ? "Saved on this computer. Paste a new key to replace it." : "Create a key at dashboard.composio.dev, or set COMPOSIO_API_KEY before starting Nimbus."}>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={source === "none" ? "ak_…" : "••••••••"} className="h-11 pr-12 pl-9 font-mono text-base lg:h-9 lg:text-xs" autoComplete="off" />
              <button type="button" onClick={() => setShowKey((s) => !s)} className="absolute top-1/2 right-1 flex size-10 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground" aria-label={showKey ? "Hide key" : "Show key"}>{showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button>
            </div>
            <div className={cn("grid gap-2", source === "settings" ? "grid-cols-2" : "grid-cols-1", "lg:flex lg:shrink-0")}>
              <Button className="h-11 lg:h-9" onClick={() => void saveKey()} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : null}Save</Button>
              {source === "settings" && <Button variant="outline" className="h-11 lg:h-9" onClick={() => void clearKey()}>Remove</Button>}
            </div>
          </div>
        </Field>
      </Section>

      <Section title="Directory" description="Search, then connect. In Ask mode, actions that change data wait for your approval.">
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search apps" className="h-11 rounded-xl pl-9 text-base lg:h-9 lg:text-sm" />
          </div>
          <Button variant="outline" size="icon" className="size-11 shrink-0 rounded-xl lg:size-9" onClick={() => void load()} disabled={loading} aria-label="Refresh apps"><RefreshCw className={cn("size-4", loading && "animate-spin")} /></Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{apps?.error ? apps.error : enabled && source !== "none" ? `${connectedApps.length} connected · ${available.length} not connected. A check means the account is linked.` : "Save a key to load every app and see which accounts are connected."}</p>
        {loading && list.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading apps…</div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing matches “{query.trim()}”. Connect it by slug below.</p>
        ) : (
          <div className="space-y-5">
            {connectedApps.length > 0 ? (
              <AppGroup title="Connected" apps={connectedApps} busy={busy} canConnect={source !== "none" && enabled} onConnect={connect} />
            ) : !needle ? (
              <div>
                <p className="mb-2 px-1 text-[13px] font-medium text-muted-foreground">Connected</p>
                <p className="rounded-xl border border-dashed px-3 py-3 text-sm text-muted-foreground">No apps connected yet.</p>
              </div>
            ) : null}
            {groups.length > 0 && groups[0]?.title !== "Not connected" && (
              <p className="px-1 text-sm font-medium">Not connected</p>
            )}
            {groups.map((group) => (
              <AppGroup key={group.title} title={group.title} apps={group.apps} busy={busy} canConnect={source !== "none" && enabled} onConnect={connect} />
            ))}
          </div>
        )}
        <Field label="Connect by slug" hint="For an app that is not in the list. Example: figma">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="figma" className="h-11 font-mono text-base lg:h-9 lg:text-xs" />
            <Button variant="outline" className="h-11 shrink-0 lg:h-8" disabled={!custom.trim() || busy === custom.trim().toLowerCase() || source === "none" || !enabled} onClick={() => void connect(custom)}>
              <ExternalLink />Connect
            </Button>
          </div>
        </Field>
      </Section>
    </div>
  );
}

function AppGroup({ title, apps, busy, canConnect, onConnect }: { title: string; apps: ComposioAppState[]; busy: string | null; canConnect: boolean; onConnect: (slug: string) => void }) {
  if (apps.length === 0) return null;
  return (
    <div>
      <p className="mb-2 px-1 text-[13px] font-medium text-muted-foreground">{title}</p>
      <ul className="overflow-hidden rounded-2xl border bg-surface lg:grid lg:grid-cols-2 lg:gap-2 lg:overflow-visible lg:rounded-none lg:border-0 lg:bg-transparent">
        {apps.map((app) => {
          const pending = busy === app.slug;
          return (
            <li key={app.slug} className="border-b last:border-b-0 lg:rounded-xl lg:border lg:bg-surface">
              <button
                type="button"
                disabled={pending || !canConnect || app.connected}
                onClick={() => onConnect(app.slug)}
                className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left active:bg-muted disabled:active:bg-transparent"
              >
                {app.logo ? <img src={app.logo} alt="" loading="lazy" className="size-10 shrink-0 rounded-xl bg-white object-contain p-1" /> : <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-semibold text-muted-foreground">{app.name.slice(0, 1)}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] leading-tight font-medium">{app.name}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{app.connected ? "Connected" : app.noAuth ? "Not connected · no sign-in required" : app.blurb}</span>
                </span>
                <span className="flex w-[4.75rem] shrink-0 items-center justify-end">
                  {pending ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : app.connected ? <Check className="size-5 text-success" aria-label="Connected" /> : <span className="text-[15px] font-semibold whitespace-nowrap text-primary">Connect</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function groupApps(apps: ComposioAppState[]): { title: string; apps: ComposioAppState[] }[] {
  const ordered = [...apps].sort((a, b) => Number(a.noAuth) - Number(b.noAuth) || a.name.localeCompare(b.name));
  const hasCategories = ordered.some((app) => app.category);
  if (!hasCategories) return ordered.length ? [{ title: "Not connected", apps: ordered }] : [];
  const buckets = new Map<string, ComposioAppState[]>();
  for (const app of ordered) {
    const title = app.category?.trim() || "Other";
    const list = buckets.get(title);
    if (list) list.push(app);
    else buckets.set(title, [app]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]) || b[1].length - a[1].length)
    .map(([title, items]) => ({ title, apps: items }));
}
