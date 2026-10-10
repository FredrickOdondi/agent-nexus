import { spawn } from "node:child_process";
import type { BackgroundProcess, ProcessManager, ToolDefinition } from "../types.js";
import { clampText } from "../util/fs.js";

const MAX_OUTPUT = 30_000;

interface TerminalArgs {
  command: string;
  cwd?: string;
  timeout_ms?: number;
  background?: boolean;
  explanation?: string;
}

function shellFor(): { bin: string; args: string[] } {
  if (process.platform === "win32") return { bin: process.env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c"] };
  return { bin: process.env.SHELL && /bash|zsh/.test(process.env.SHELL) ? process.env.SHELL : "/bin/bash", args: ["-lc"] };
}

export function createProcessManager(): ProcessManager {
  const procs = new Map<string, BackgroundProcess>();
  let counter = 0;
  return {
    start(command, cwd, env) {
      const id = `proc_${++counter}_${Date.now().toString(36)}`;
      const { bin, args } = shellFor();
      const child = spawn(bin, [...args, command], {
        cwd,
        env: { ...process.env, ...env, FORCE_COLOR: "0", CI: "1", TERM: "dumb" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const rec: BackgroundProcess = {
        id,
        command,
        startedAt: Date.now(),
        exitCode: null,
        output: "",
        done: new Promise<void>((resolve) => {
          const onData = (d: Buffer) => {
            rec.output = clampTail(rec.output + d.toString(), 200_000);
          };
          child.stdout.on("data", onData);
          child.stderr.on("data", onData);
          child.on("error", (e) => {
            rec.output += `\n[spawn error] ${e.message}`;
            rec.exitCode = 127;
            resolve();
          });
          child.on("close", (code) => {
            rec.exitCode = code ?? 0;
            resolve();
          });
        }),
        kill() {
          try {
            child.kill("SIGTERM");
            setTimeout(() => { if (rec.exitCode === null) child.kill("SIGKILL"); }, 2000).unref();
          } catch { /* already dead */ }
        },
      };
      procs.set(id, rec);
      return rec;
    },
    get: (id) => procs.get(id),
    list: () => [...procs.values()],
    killAll() {
      for (const p of procs.values()) if (p.exitCode === null) p.kill();
    },
  };
}

function clampTail(text: string, max: number): string {
  return text.length > max ? text.slice(text.length - max) : text;
}

export const runTerminalCmd: ToolDefinition<TerminalArgs> = {
  id: "run_terminal_cmd",
  title: "bash",
  category: "shell",
  description:
    "Execute a shell command in the workspace. Output is streamed and truncated to 30k chars. Use `background: true` for long-running servers/watchers and poll with get_task_output. Never run interactive commands (use non-interactive flags). Commands time out after `timeout_ms` (default 120000).",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to run." },
      cwd: { type: "string", description: "Working directory (absolute or relative to the workspace)." },
      timeout_ms: { type: "number", description: "Timeout in milliseconds. Default 120000, max 600000." },
      background: { type: "boolean", description: "Run detached and return a task id immediately." },
      explanation: { type: "string", description: "One sentence on why this command is being run." },
    },
    required: ["command"],
  },
  permission: "Bash",
  readOnly: false,
  summarize: (a) => a.command,
  permissionSubject: (a) => a.command,
  async execute(args, ctx) {
    const cwd = args.cwd ? (args.cwd.startsWith("/") || /^[a-zA-Z]:\\/.test(args.cwd) ? args.cwd : `${ctx.cwd}/${args.cwd}`) : ctx.cwd;
    const proc = ctx.session.processes.start(args.command, cwd);

    if (args.background) {
      return {
        output: `Started background process ${proc.id} in ${cwd}. Use get_task_output with id "${proc.id}" to read output.`,
        display: { kind: "terminal", command: args.command, output: "", exitCode: null, cwd },
      };
    }

    const timeout = Math.min(Math.max(args.timeout_ms ?? 120_000, 1000), 600_000);
    let timedOut = false;
    let lastSent = 0;
    const streamer = setInterval(() => {
      if (proc.output.length > lastSent) {
        ctx.progress(proc.output.slice(lastSent));
        lastSent = proc.output.length;
      }
    }, 250);
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);
    const onAbort = () => proc.kill();
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    await proc.done;
    clearInterval(streamer);
    clearTimeout(timer);
    ctx.signal.removeEventListener("abort", onAbort);

    const output = clampText(proc.output, MAX_OUTPUT);
    const status = timedOut
      ? `Command timed out after ${timeout}ms and was killed.`
      : ctx.signal.aborted
        ? "Command was cancelled."
        : `Exit code: ${proc.exitCode}`;
    return {
      output: `${output}${output ? "\n" : ""}${status}`,
      isError: timedOut || (proc.exitCode ?? 0) !== 0,
      display: { kind: "terminal", command: args.command, output: proc.output, exitCode: proc.exitCode, cwd },
    };
  },
};
