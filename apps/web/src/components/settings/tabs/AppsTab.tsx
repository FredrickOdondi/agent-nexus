import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, KeyRound, Loader2, Plug, RefreshCw, Search } from "lucide-react";
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
  const ready = filtered.filter((app) => app.connected || app.noAuth);
  const available = filtered.filter((app) => !app.connected && !app.noAuth);
  const groups = groupApps(available);

  return (
    <div>
      <Section title="Connected apps" description="Link Gmail, GitHub, Slack, and the rest. The agent searches those apps and runs actions during a chat. The key stays on this computer and is never sent to your phone.">
        <ToggleRow
          label="Let the agent use connected apps"
          hint="Turn this off to hide app tools without deleting the key or the accounts you already linked."
          checked={enabled}
          onChange={(value) => void send({ type: "settings.update", patch: { composioEnabled: value } }).catch((error) => toast.error((error as Error).message))}
        />
        <Field label="Composio API key" hint={source === "env" ? "Using COMPOSIO_API_KEY from the environment. A key saved here replaces it." : source === "settings" ? "Saved on this computer. Paste a new key to replace it." : "Create a key at dashboard.composio.dev. You can also set COMPOSIO_API_KEY before starting Nimbus."}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={source === "none" ? "ak_…" : "••••••••"} className="pr-9 pl-8 font-mono text-xs" autoComplete="off" />
              <button type="button" onClick={() => setShowKey((s) => !s)} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showKey ? "Hide key" : "Show key"}>{showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
            </div>
            <Button onClick={() => void saveKey()} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : null}Save</Button>
            {source === "settings" && <Button variant="outline" onClick={() => void clearKey()}>Remove</Button>}
          </div>
        </Field>
      </Section>

      <Section title="Apps" description="The full Composio directory. Connect an account, then ask in chat. In Ask mode, actions that change data wait for your approval.">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{apps?.error ? apps.error : enabled && source !== "none" ? `${list.length} apps. Open a connect link, approve access, then come back.` : "Save a key to load the full directory and see which accounts are already connected."}</p>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={cn(loading && "animate-spin")} />Refresh</Button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Gmail, Figma, HubSpot…" className="h-11 rounded-xl pl-9 text-base lg:h-9 lg:text-sm" />
        </div>
        {loading && list.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading apps…</div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No app matches “{query.trim()}”. Connect it by slug below if Composio has it.</p>
        ) : (
          <div className="space-y-5">
            {ready.length > 0 && <AppGroup title="Ready" apps={ready} busy={busy} canConnect={source !== "none" && enabled} onConnect={connect} />}
            {groups.map((group) => (
              <AppGroup key={group.title} title={group.title} apps={group.apps} busy={busy} canConnect={source !== "none" && enabled} onConnect={connect} />
            ))}
          </div>
        )}
        <Field label="Connect by slug" hint="Use this when an app is missing from the directory. The slug is the Composio id, such as figma or hubspot.">
          <div className="flex gap-2">
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="figma" className="font-mono text-xs" />
            <Button variant="outline" disabled={!custom.trim() || busy === custom.trim().toLowerCase() || source === "none" || !enabled} onClick={() => void connect(custom)}>
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
      <p className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {apps.map((app) => {
          const ready = app.connected || app.noAuth;
          return (
            <li key={app.slug} className="flex items-center gap-3 rounded-xl border bg-surface px-3 py-2.5">
              {app.logo ? <img src={app.logo} alt="" loading="lazy" className="size-8 rounded-md bg-white object-contain" /> : <span className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">{app.name.slice(0, 1)}</span>}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{app.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{ready ? (app.noAuth && !app.connected ? "No sign-in required" : "Connected") : app.blurb}</span>
              </span>
              <Button size="sm" variant={ready ? "outline" : "secondary"} className="max-lg:h-10" disabled={busy === app.slug || !canConnect} onClick={() => onConnect(app.slug)}>
                {busy === app.slug ? <Loader2 className="animate-spin" /> : ready ? <Check /> : <Plug />}
                {ready ? "Reconnect" : "Connect"}
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function groupApps(apps: ComposioAppState[]): { title: string; apps: ComposioAppState[] }[] {
  const hasCategories = apps.some((app) => app.category);
  if (!hasCategories) return apps.length ? [{ title: "All apps", apps }] : [];
  const buckets = new Map<string, ComposioAppState[]>();
  for (const app of apps) {
    const title = app.category?.trim() || "Other";
    const list = buckets.get(title);
    if (list) list.push(app);
    else buckets.set(title, [app]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]) || b[1].length - a[1].length)
    .map(([title, items]) => ({ title, apps: items }));
}
