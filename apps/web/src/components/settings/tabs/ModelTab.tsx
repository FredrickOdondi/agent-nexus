import { useEffect, useState } from "react";
import { Check, Eye, EyeOff, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { ProviderKind } from "@nimbus/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStore } from "@/lib/store";
import { Field, Section, ToggleRow, selectClass } from "../SettingsDialog";

const PROVIDER_ORDER: ProviderKind[] = ["deepseek", "xai", "openai_compatible", "mock"];

const PRESETS: Record<ProviderKind, { label: string; baseUrl: string; models: string[]; keyHint: string }> = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", models: ["deepseek-v4-pro", "deepseek-flash"], keyHint: "Create a key at platform.deepseek.com. You can also set DEEPSEEK_API_KEY before starting Nimbus. Thinking mode stays on so tool calls keep their reasoning." },
  xai: { label: "xAI Grok (Responses API + Agent Tools)", baseUrl: "https://api.x.ai/v1", models: ["grok-4-1-fast-reasoning", "grok-4-1-fast-non-reasoning", "grok-4", "grok-3-mini"], keyHint: "Create a key at console.x.ai. Enables server-side web_search, x_search and code_execution." },
  openai_compatible: { label: "OpenAI-compatible (OpenAI, OpenRouter, Ollama, LM Studio…)", baseUrl: "https://api.openai.com/v1", models: ["gpt-4.1-mini", "gpt-4.1", "o4-mini", "llama3.1", "qwen2.5-coder:14b"], keyHint: "Any chat/completions endpoint with function calling. Ollama: http://localhost:11434/v1 (no key needed)." },
  mock: { label: "Offline demo (no model)", baseUrl: "", models: ["nimbus-demo"], keyHint: "Scripted responses that still exercise the tool loop. Great for exploring the UI." },
};

export function ModelTab() {
  const settings = useStore((s) => s.settings);
  const send = useStore((s) => s.send);
  const [kind, setKind] = useState<ProviderKind>("deepseek");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [serverTools, setServerTools] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setKind(settings.provider.kind);
    setBaseUrl(settings.provider.baseUrl);
    setModel(settings.provider.model);
    setServerTools(settings.provider.serverTools);
    setApiKey("");
  }, [settings]);

  const changeKind = (k: ProviderKind) => {
    setKind(k);
    setBaseUrl(PRESETS[k].baseUrl);
    setModel(PRESETS[k].models[0]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const provider: Record<string, unknown> = { kind, baseUrl, model, serverTools };
      if (apiKey.trim()) provider.apiKey = apiKey.trim();
      await send({ type: "settings.update", patch: { provider } as never });
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      toast.success("Model settings saved");
      setApiKey("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clearKey = async () => {
    try {
      await send({ type: "settings.update", patch: { provider: { apiKey: "" } } as never });
      toast.success("API key removed");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!settings) return null;
  const preset = PRESETS[kind];

  return (
    <div>
      <Section title="Model provider" description="Keys are stored only on the host machine and never sent to linked devices.">
        <Field label="Provider">
          <select className={selectClass} value={kind} onChange={(e) => changeKind(e.target.value as ProviderKind)}>
            {PROVIDER_ORDER.map((k) => <option key={k} value={k}>{PRESETS[k].label}</option>)}
          </select>
        </Field>
        {kind !== "mock" && (
          <>
            <Field label="Base URL">
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={preset.baseUrl} className="font-mono text-xs" />
            </Field>
            <Field label="Model" hint="Type any model id your endpoint supports.">
              <Input list="model-suggestions" value={model} onChange={(e) => setModel(e.target.value)} className="font-mono text-xs" />
              <datalist id="model-suggestions">{preset.models.map((m) => <option key={m} value={m} />)}</datalist>
            </Field>
            <Field label="API key" hint={preset.keyHint}>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <KeyRound className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={settings.provider.hasApiKey ? "•••••••• (saved — enter a new key to replace)" : "sk-…"} className="pr-9 pl-8 font-mono text-xs" autoComplete="off" />
                  <button type="button" onClick={() => setShowKey((s) => !s)} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={showKey ? "Hide key" : "Show key"}>{showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</button>
                </div>
                {settings.provider.hasApiKey && <Button variant="outline" onClick={clearKey}>Remove</Button>}
              </div>
            </Field>
            {kind === "xai" && (
              <ToggleRow label="xAI Agent Tools (server-side)" hint="Let Grok run web_search, x_search and code_execution on xAI's infrastructure, in parallel, inside one request." checked={serverTools} onChange={setServerTools} />
            )}
          </>
        )}
        <div className="flex items-center gap-2 pt-1">
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : null}{saved ? "Saved" : "Save changes"}</Button>
          <span className="text-xs text-muted-foreground">Current: <span className="font-mono">{settings.provider.kind === "mock" ? "offline demo" : `${settings.provider.model}${settings.provider.hasApiKey ? "" : " (no key → demo)"}`}</span></span>
        </div>
      </Section>
    </div>
  );
}
