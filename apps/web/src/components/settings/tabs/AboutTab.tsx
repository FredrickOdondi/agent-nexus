import { useEffect, useState } from "react";
import type { HealthInfo } from "@nimbus/shared";
import { AlertCircle, Check, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { NimbusMark } from "@/components/brand/NimbusMark";
import { Button } from "@/components/ui/button";
import { bridge, isElectron } from "@/lib/platform";
import { useAutoUpdater } from "@/lib/useAutoUpdater";
import { Section } from "../SettingsDialog";

export function AboutTab() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => setHealth(null));
  }, []);
  const rows: [string, string][] = [
    ["Client", isElectron ? `Desktop${bridge?.version ? ` ${bridge.version}` : ""}` : "Web"],
    ["Server", health ? `v${health.version} · up ${Math.round(health.uptimeMs / 60000)} min` : "unreachable"],
  ];
  return (
    <div>
      <Section title="Nimbus" description="A local agent workspace. Chats and files stay on this computer.">
        <div className="flex items-center gap-3">
          <NimbusMark size={52} />
          <p className="text-sm leading-relaxed text-muted-foreground">The cloud is the mark. It drifts while Nimbus is idle and breathes while something is loading.</p>
        </div>
        <dl className="divide-y rounded-xl border bg-surface text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[120px_1fr] gap-3 px-3.5 py-2.5"><dt className="text-muted-foreground">{k}</dt><dd className="truncate font-mono text-xs leading-5" title={v}>{v}</dd></div>
          ))}
        </dl>
      </Section>
      {isElectron && (
        <Section title="Software Updates" description="Keep Nimbus up to date with the latest features and security improvements.">
          <UpdaterControls />
        </Section>
      )}
      <Section title="Architecture" description="How the agent on this computer is put together.">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li><span className="text-foreground">ToolRegistry → ToolBridge + SessionContext</span>: tools are composed per session; capabilities without a backing resource are removed, not advertised.</li>
          <li><span className="text-foreground">Built-in tools</span>: run_terminal_cmd, read_file, write_file, search_replace, list_dir, glob, grep, web_search, web_fetch, todo_write, task, get_task_output, ask_user_question, memory, plan mode, skill, image_gen, computer (see and click this computer’s screen).</li>
          <li><span className="text-foreground">Provider-hosted tools</span>: xAI Agent Tools API (web_search, x_search, code_execution) run inside the model request.</li>
          <li><span className="text-foreground">Connected apps</span>: Composio sessions let the agent search, connect, and run Gmail, GitHub, Slack, and other apps. The API key stays on this computer.</li>
          <li><span className="text-foreground">Governance</span>: permission modes and ToolPrefix(glob) rules, PreToolUse/PostToolUse hooks, AGENTS.md rules, SKILL.md skills, MCP servers, checkpoints with rewind.</li>
          <li><span className="text-foreground">Sync</span>: a per-space event log with monotonic sequence numbers; every device replays what it missed.</li>
        </ul>
      </Section>
    </div>
  );
}

function UpdaterControls() {
  const { status, checking, checkForUpdates, installUpdate, hasUpdateDownloaded, isDownloading } = useAutoUpdater();
  const currentVersion = bridge?.version ?? "0.1.1";

  return (
    <div className="rounded-xl border bg-surface p-3.5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">Installed Version</span>
            <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">v{currentVersion}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {hasUpdateDownloaded ? (
              <span className="text-emerald-500 font-medium flex items-center gap-1">
                <Check className="size-3.5" /> Version {status?.version} downloaded and ready to apply
              </span>
            ) : isDownloading ? (
              <span className="text-primary flex items-center gap-1">
                <Loader2 className="size-3.5 animate-spin" /> Downloading update ({status?.percent ?? 0}%)…
              </span>
            ) : status?.state === "checking" || checking ? (
              <span className="flex items-center gap-1">
                <Loader2 className="size-3.5 animate-spin" /> Checking for updates…
              </span>
            ) : status?.state === "not-available" ? (
              "Nimbus is on the latest available version."
            ) : status?.state === "dev" ? (
              "Running in development mode (updates disabled)."
            ) : status?.state === "error" ? (
              <span className="text-destructive flex items-center gap-1">
                <AlertCircle className="size-3.5" /> {status.message || "Could not check for updates"}
              </span>
            ) : (
              "Auto-updates check periodically via GitHub Releases."
            )}
          </p>
        </div>

        {hasUpdateDownloaded ? (
          <Button size="sm" onClick={() => void installUpdate()} className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-sm">
            <Sparkles className="size-3.5" /> Restart & Install
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={checking || isDownloading}
            onClick={() => void checkForUpdates()}
            className="gap-1.5 text-xs"
          >
            {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Check for Updates
          </Button>
        )}
      </div>

      {isDownloading && typeof status?.percent === "number" && (
        <div className="space-y-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, status.percent))}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>Downloading update asset…</span>
            <span>{status.percent}%</span>
          </div>
        </div>
      )}
    </div>
  );
}
