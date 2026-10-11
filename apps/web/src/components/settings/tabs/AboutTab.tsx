import { useEffect, useState } from "react";
import type { HealthInfo } from "@nimbus/shared";
import { bridge, isElectron } from "@/lib/platform";
import { Section } from "../SettingsDialog";

export function AboutTab() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
  }, []);
  const rows: [string, string][] = [
    ["Client", isElectron ? `Desktop (Electron ${bridge?.version ?? ""})` : "Web / PWA"],
    ["Server", health ? `v${health.version} · up ${Math.round(health.uptimeMs / 60000)} min` : "unreachable"],
    ["Data directory", health?.dataDir ?? "—"],
    ["LAN addresses", health?.lanUrls.join(", ") || "—"],
  ];
  return (
    <div>
      <Section title="Nimbus" description="A local-first agent workspace. Lightweight Vite + React client, Hono + SQLite sync server, Electron shell — no Next.js.">
        <dl className="divide-y rounded-xl border bg-surface text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[120px_1fr] gap-3 px-3.5 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="truncate font-mono text-xs leading-5" title={v}>{v}</dd></div>
          ))}
        </dl>
      </Section>
      <Section title="Architecture" description="Modelled on xAI's Grok Build agent harness.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li><span className="text-foreground">ToolRegistry → ToolBridge + SessionContext</span>: tools are composed per session; capabilities without a backing resource are removed, not advertised.</li>
          <li><span className="text-foreground">Built-in tools</span>: run_terminal_cmd, read_file, write_file, search_replace, list_dir, glob, grep, web_search, web_fetch, todo_write, task, get_task_output, ask_user_question, memory, plan mode, skill, image_gen.</li>
          <li><span className="text-foreground">Provider-hosted tools</span>: xAI Agent Tools API (web_search, x_search, code_execution) run inside the model request.</li>
          <li><span className="text-foreground">Governance</span>: permission modes and ToolPrefix(glob) rules, PreToolUse/PostToolUse hooks, AGENTS.md rules, SKILL.md skills, MCP servers, checkpoints with rewind.</li>
          <li><span className="text-foreground">Sync</span>: a per-space event log with monotonic sequence numbers; every device replays what it missed, like WhatsApp multi-device.</li>
        </ul>
      </Section>
    </div>
  );
}
