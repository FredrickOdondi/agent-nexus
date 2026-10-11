import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, KeyRound, Loader2, Plug, RefreshCw } from "lucide-react";
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

      <Section title="Apps" description="Connect an account, then ask in chat. In Ask mode, actions that change data wait for your approval.">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{apps?.error ? apps.error : enabled && source !== "none" ? "Open a connect link, approve access, then return to this tab." : "Save a key to see which accounts are already connected."}</p>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={cn(loading && "animate-spin")} />Refresh</Button>
        </div>
        {loading && list.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading apps…</div>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {list.map((app) => {
              const ready = app.connected || app.noAuth;
              return (
                <li key={app.slug} className="flex items-center gap-3 rounded-xl border bg-surface px-3 py-2.5">
                  {app.logo ? <img src={app.logo} alt="" className="size-8 rounded-md object-contain" /> : <span className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-semibold text-muted-foreground">{app.name.slice(0, 1)}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{app.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{ready ? (app.noAuth && !app.connected ? "No sign-in required" : "Connected") : app.blurb}</span>
                  </span>
                  <Button size="sm" variant={ready ? "outline" : "secondary"} disabled={busy === app.slug || source === "none" || !enabled} onClick={() => void connect(app.slug)}>
                    {busy === app.slug ? <Loader2 className="animate-spin" /> : ready ? <Check /> : <Plug />}
                    {ready ? "Reconnect" : "Connect"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        <Field label="Another app" hint="Any Composio toolkit slug, for example figma or hubspot.">
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
