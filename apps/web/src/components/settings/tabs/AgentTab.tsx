import { useEffect, useState } from "react";
import { Check, FolderOpen, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { McpServerConfig, PermissionMode } from "@nimbus/shared";
import { COMPOSIO_META_TOOLS, newId } from "@nimbus/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useStore } from "@/lib/store";
import { bridge } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Field, Section, ToggleRow, selectClass } from "../SettingsDialog";

const MODES: { value: PermissionMode; label: string; hint: string }[] = [
  { value: "ask", label: "Ask before changes", hint: "Reads are automatic. Edits, commands, and screen clicks need approval from any device." },
  { value: "auto", label: "Always approve", hint: "Fully autonomous. Deny rules still apply." },
  { value: "plan", label: "Plan only", hint: "Research and plan; all mutations blocked until plan approval." },
  { value: "read_only", label: "Read only", hint: "No edits or commands at all." },
];

export function AgentTab() {
  const settings = useStore((s) => s.settings);
  const tools = useStore((s) => s.tools);
  const showComposio = Boolean(settings?.hasComposioApiKey && settings.composioEnabled !== false);
  const visibleTools = [
    ...tools.filter((tool) => showComposio || tool.source !== "composio"),
    ...COMPOSIO_META_TOOLS.filter((meta) => showComposio && !tools.some((tool) => tool.id === meta.id)).map((tool) => ({ ...tool, enabled: true })),
  ];
  const skills = useStore((s) => s.skills);
  const send = useStore((s) => s.send);
  const [workspace, setWorkspace] = useState("");
  const [allow, setAllow] = useState("");
  const [deny, setDeny] = useState("");
  const [addendum, setAddendum] = useState("");
  const [mcp, setMcp] = useState<McpServerConfig[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setWorkspace(settings.workspacePath);
    setAllow(settings.allowRules.join("\n"));
    setDeny(settings.denyRules.join("\n"));
    setAddendum(settings.systemPromptAddendum);
    setMcp(settings.mcpServers);
  }, [settings]);

  if (!settings) return null;

  const patch = (p: Record<string, unknown>) => send({ type: "settings.update", patch: p as never }).catch((e) => toast.error((e as Error).message));
  const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

  const save = async () => {
    setSaving(true);
    try {
      await send({ type: "settings.update", patch: { workspacePath: workspace.trim() || settings.workspacePath, allowRules: lines(allow), denyRules: lines(deny), systemPromptAddendum: addendum, mcpServers: mcp.filter((m) => m.name.trim() && (m.transport === "stdio" ? m.command?.trim() : m.url?.trim())) } });
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      toast.success("Agent settings saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Section title="Workspace" description="The directory the agent reads, edits and runs commands in. Each chat can override it.">
        <div className="flex gap-2">
          <Input value={workspace} onChange={(e) => setWorkspace(e.target.value)} className="font-mono text-xs" />
          {bridge && <Button variant="outline" onClick={async () => { const p = await bridge!.pickFolder(); if (p) setWorkspace(p); }}><FolderOpen /> Browse</Button>}
        </div>
      </Section>

      <Section title="Permissions" description="Mirrors Grok Build's permission model: a mode plus allow/deny rules in ToolPrefix(glob) syntax.">
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <button key={m.value} type="button" onClick={() => void patch({ permissionMode: m.value })} className={cn("rounded-xl border p-3 text-left transition-colors hover:bg-muted/40", settings.permissionMode === m.value && "border-primary bg-primary/5 ring-2 ring-primary/10")}>
              <span className="flex items-center gap-2 text-sm font-medium">{settings.permissionMode === m.value && <Check className="size-3.5 text-primary" />}{m.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{m.hint}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Allow rules" hint="One per line. e.g. Bash(git *), Edit(src/**), Computer(screenshot)">
            <Textarea value={allow} onChange={(e) => setAllow(e.target.value)} rows={4} className="font-mono text-xs" />
          </Field>
          <Field label="Deny rules" hint="Always win. e.g. Bash(rm -rf *), Write(.env*), Computer(*)">
            <Textarea value={deny} onChange={(e) => setDeny(e.target.value)} rows={4} className="font-mono text-xs" />
          </Field>
        </div>
      </Section>

      <Section title="Capabilities">
        <ToggleRow label="Web search" hint="Local search (DuckDuckGo / Brave key) or xAI server-side when enabled." checked={settings.webSearchEnabled} onChange={(v) => void patch({ webSearchEnabled: v })} />
        <ToggleRow label="Subagents" hint="Let the agent delegate to explore / general / plan / review children running in parallel." checked={settings.subagentsEnabled} onChange={(v) => void patch({ subagentsEnabled: v })} />
        <ToggleRow label="Cross-session memory" hint="Global and per-workspace MEMORY.md injected into the system prompt." checked={settings.memoryEnabled} onChange={(v) => void patch({ memoryEnabled: v })} />
      </Section>

      <Section title="Tools" description="Everything the model can call this session.">
        <div className="flex flex-wrap gap-1.5">
          {visibleTools.map((t) => (
            <Badge key={t.id} variant={t.enabled ? "secondary" : "outline"} className={cn("h-6 gap-1 px-2 font-mono text-[11px]", !t.enabled && "opacity-50")} title={t.description}>
              {t.title}{t.source === "provider" && <span className="text-[9px] text-primary">xAI</span>}{t.source === "composio" && <span className="text-[9px] text-primary">app</span>}
            </Badge>
          ))}
        </div>
        {skills.length > 0 && (
          <div>
            <p className="mb-1.5 text-sm font-medium">Skills</p>
            <ul className="space-y-1">{skills.map((s) => <li key={s.name} className="text-xs"><span className="font-mono font-medium">{s.name}</span> <span className="text-muted-foreground">— {s.description}</span></li>)}</ul>
          </div>
        )}
      </Section>

      <Section title="MCP servers" description="Expose external tools (Linear, Postgres, browsers…) to the agent via the Model Context Protocol.">
        <div className="space-y-2">
          {mcp.map((m, i) => (
            <div key={m.id} className="grid gap-2 rounded-xl border bg-surface p-3 sm:grid-cols-[1fr_auto_2fr_auto]">
              <Input value={m.name} onChange={(e) => setMcp(mcp.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" className="text-xs" />
              <select className={cn(selectClass, "w-auto")} value={m.transport} onChange={(e) => setMcp(mcp.map((x, j) => (j === i ? { ...x, transport: e.target.value as "stdio" | "http" } : x)))}><option value="stdio">stdio</option><option value="http">http</option></select>
              {m.transport === "stdio" ? (
                <Input value={[m.command, ...(m.args ?? [])].filter(Boolean).join(" ")} onChange={(e) => { const [command, ...args] = e.target.value.split(/\s+/); setMcp(mcp.map((x, j) => (j === i ? { ...x, command, args } : x))); }} placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp" className="font-mono text-xs" />
              ) : (
                <Input value={m.url ?? ""} onChange={(e) => setMcp(mcp.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://mcp.example.com/mcp" className="font-mono text-xs" />
              )}
              <div className="flex items-center gap-1">
                <ToggleMini checked={m.enabled} onChange={(v) => setMcp(mcp.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} />
                <Button variant="ghost" size="icon-sm" onClick={() => setMcp(mcp.filter((_, j) => j !== i))} aria-label="Remove server"><Trash2 /></Button>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setMcp([...mcp, { id: newId("mcp"), name: "", transport: "stdio", command: "", args: [], enabled: true }])}><Plus /> Add server</Button>
        </div>
      </Section>

      <Section title="Custom instructions" description="Appended to the system prompt for every chat. Project rules from AGENTS.md are loaded automatically.">
        <Textarea value={addendum} onChange={(e) => setAddendum(e.target.value)} rows={4} placeholder="e.g. Prefer pnpm. Write tests with Vitest. Keep commit messages in imperative mood." />
      </Section>

      <div className="sticky bottom-0 -mx-4 flex items-center gap-2 border-t bg-background/90 px-4 py-3 glass sm:-mx-6 sm:px-6">
        <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : saved ? <Check /> : null}{saved ? "Saved" : "Save changes"}</Button>
        <span className="text-xs text-muted-foreground">Toggles and permission mode save instantly.</span>
      </div>
    </div>
  );
}

function ToggleMini({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors", checked ? "bg-primary" : "bg-input")}>
      <span className={cn("absolute size-4 rounded-full bg-background elevation-1 transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
    </button>
  );
}
