import { promises as fs } from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "../types.js";
import { run, sleep } from "./screen-proc.js";

interface ActiveWatcher {
  id: string;
  filePath: string;
  pattern?: string;
  notify: boolean;
  intervalHandle?: NodeJS.Timeout;
  lastOffset: number;
  matches: string[];
  status: "active" | "stopped";
}

const watchers = new Map<string, ActiveWatcher>();
let nextWatchId = 1;

async function sendNotification(title: string, message: string) {
  const safeTitle = title.replace(/"/g, '\\"');
  const safeMsg = message.replace(/"/g, '\\"');

  if (process.platform === "darwin") {
    try {
      await run("osascript", ["-e", `display notification "${safeMsg}" with title "${safeTitle}"`]);
    } catch {
      // ignore
    }
  } else if (process.platform === "win32") {
    try {
      await run("powershell", [
        "-Command",
        `[reflection.assembly]::loadwithpartialname('System.Windows.Forms'); [System.Windows.Forms.MessageBox]::Show('${safeMsg}', '${safeTitle}')`,
      ]);
    } catch {
      // ignore
    }
  } else if (process.platform === "linux") {
    try {
      await run("notify-send", [safeTitle, safeMsg]);
    } catch {
      // ignore
    }
  }
}

interface WatchArgs {
  action: "wait_for" | "start_watch" | "stop_watch" | "list";
  path: string;
  pattern?: string;
  event?: "change" | "create" | "match";
  timeout_seconds?: number;
  watch_id?: string;
  notify?: boolean;
}

export const fileWatchTool: ToolDefinition<WatchArgs> = {
  id: "file_watch",
  title: "file_watch",
  category: "workflow",
  description: [
    "Watch files, build logs, and directories for changes or specific text patterns (e.g. 'ERROR', 'Build succeeded').",
    "Actions:",
    "- wait_for: Pause and wait up to `timeout_seconds` (default 30s) for a file to be created, modified, or for a regex/string `pattern` to appear in new content.",
    "- start_watch: Start a background monitor on a log file. Whenever `pattern` appears, triggers a desktop alert.",
    "- stop_watch: Stop an active background watcher (watch_id).",
    "- list: List all currently active watchers.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["wait_for", "start_watch", "stop_watch", "list"], description: "Watch action." },
      path: { type: "string", description: "Path to the file or directory to watch." },
      pattern: { type: "string", description: "Text or regex pattern to look for in new content (e.g. 'ERROR', 'success', 'Done in')." },
      event: { type: "string", enum: ["change", "create", "match"], description: "Event to wait for in wait_for (defaults to match if pattern is given, else change)." },
      timeout_seconds: { type: "number", description: "Max seconds to wait in wait_for (default 30, max 300)." },
      watch_id: { type: "string", description: "Watcher ID for stop_watch (e.g. 'watch_1')." },
      notify: { type: "boolean", description: "Whether start_watch sends desktop notifications on match (defaults to true)." },
    },
    required: ["action"],
  },
  permission: "Read",
  readOnly: true,
  summarize: (a) => `${a.action} ${a.path ?? ""} ${a.pattern ? `for "${a.pattern}"` : ""}`.trim(),
  permissionSubject: (a) => a.path || a.action,
  async execute(args, ctx) {
    const { action } = args;

    if (action === "list") {
      if (watchers.size === 0) return { output: "No active file watchers." };
      const lines = ["Active file watchers:"];
      for (const [id, w] of watchers.entries()) {
        lines.push(`- [${id}] ${w.status.toUpperCase()}: ${w.filePath} ${w.pattern ? `(pattern: "${w.pattern}")` : ""} — ${w.matches.length} match(es)`);
      }
      return { output: lines.join("\n") };
    }

    if (action === "stop_watch") {
      const id = args.watch_id;
      if (!id || !watchers.has(id)) {
        return { output: `Watcher "${id ?? ""}" not found.`, isError: true };
      }
      const w = watchers.get(id)!;
      if (w.intervalHandle) clearInterval(w.intervalHandle);
      w.status = "stopped";
      return { output: `Stopped watcher ${id} for ${w.filePath}.` };
    }

    if (action === "wait_for") {
      if (!args.path) return { output: "wait_for requires a file path.", isError: true };
      const target = path.resolve(ctx.cwd, args.path);
      const timeout = Math.min(300, Math.max(1, Number(args.timeout_seconds) || 30)) * 1000;
      const pattern = args.pattern ? new RegExp(args.pattern, "i") : null;
      const mode = args.event || (pattern ? "match" : "change");

      const startTime = Date.now();
      let initialSize = 0;
      let initialMtime = 0;
      let existed = false;

      try {
        const stat = await fs.stat(target);
        initialSize = stat.size;
        initialMtime = stat.mtimeMs;
        existed = true;
      } catch {
        // File does not exist initially
      }

      if (mode === "create" && existed) {
        return { output: `File ${target} already exists.` };
      }

      while (Date.now() - startTime < timeout) {
        if (ctx.signal.aborted) {
          return { output: "Cancelled while waiting for file.", isError: true };
        }

        try {
          const stat = await fs.stat(target);
          if (mode === "create" && !existed) {
            return { output: `File created: ${target} (${Date.now() - startTime}ms)` };
          }

          if (stat.mtimeMs > initialMtime || stat.size !== initialSize) {
            if (pattern) {
              // Read newly appended content
              const handle = await fs.open(target, "r");
              try {
                const newBytesLen = Math.max(0, stat.size - initialSize);
                if (newBytesLen > 0) {
                  const buf = Buffer.alloc(Math.min(newBytesLen, 100_000));
                  const readOffset = Math.max(initialSize, stat.size - buf.length);
                  await handle.read(buf, 0, buf.length, readOffset);
                  const text = buf.toString("utf8");
                  const match = text.match(pattern);
                  if (match) {
                    const snippet = text.slice(Math.max(0, match.index! - 50), match.index! + match[0].length + 150);
                    return {
                      output: `Found pattern "${args.pattern}" in ${target} after ${Date.now() - startTime}ms:\n\n...\n${snippet.trim()}\n...`,
                    };
                  }
                }
              } finally {
                await handle.close();
              }
              initialSize = stat.size;
              initialMtime = stat.mtimeMs;
            } else {
              return { output: `File changed: ${target} (size ${stat.size} bytes, modified after ${Date.now() - startTime}ms)` };
            }
          }
        } catch {
          // File not yet present
        }

        await sleep(350);
      }

      return { output: `Timed out after ${timeout / 1000}s waiting for ${mode} on ${target}.`, isError: true };
    }

    if (action === "start_watch") {
      if (!args.path) return { output: "start_watch requires a file path.", isError: true };
      const target = path.resolve(ctx.cwd, args.path);
      const pattern = args.pattern ? new RegExp(args.pattern, "i") : null;
      const shouldNotify = args.notify !== false;

      let currentSize = 0;
      try {
        const stat = await fs.stat(target);
        currentSize = stat.size;
      } catch {
        // will watch for creation
      }

      const id = `watch_${nextWatchId++}`;
      const watcher: ActiveWatcher = {
        id,
        filePath: target,
        pattern: args.pattern,
        notify: shouldNotify,
        lastOffset: currentSize,
        matches: [],
        status: "active",
      };

      const interval = setInterval(async () => {
        try {
          const stat = await fs.stat(target);
          if (stat.size > watcher.lastOffset) {
            const handle = await fs.open(target, "r");
            try {
              const diff = stat.size - watcher.lastOffset;
              const buf = Buffer.alloc(Math.min(diff, 64_000));
              await handle.read(buf, 0, buf.length, watcher.lastOffset);
              watcher.lastOffset = stat.size;
              const text = buf.toString("utf8");

              if (pattern) {
                const match = text.match(pattern);
                if (match) {
                  const line = text.split("\n").find((l) => pattern.test(l)) || match[0];
                  watcher.matches.push(line.trim());
                  ctx.session.log("info", `[file_watch] ${id} detected: ${line}`);
                  if (watcher.notify) {
                    await sendNotification(
                      `File Alert: ${path.basename(target)}`,
                      `Matched "${args.pattern}": ${line.trim().slice(0, 120)}`,
                    );
                  }
                }
              }
            } finally {
              await handle.close();
            }
          }
        } catch {
          // ignore stat errors
        }
      }, 500);

      interval.unref?.();
      watcher.intervalHandle = interval;
      watchers.set(id, watcher);

      return {
        output: `Started background watcher ${id} on ${target}${args.pattern ? ` for pattern "${args.pattern}"` : ""}. ${shouldNotify ? "Desktop notifications enabled on match." : ""}`,
      };
    }

    return { output: `Unknown action: "${String(action)}". Use wait_for, start_watch, stop_watch, or list.`, isError: true };
  },
};
