import type { ToolDefinition } from "../types.js";
import { run } from "./screen-proc.js";

export interface ScheduledJob {
  id: string;
  label: string;
  message: string;
  createdAt: number;
  triggerAt: number;
  timerHandle?: NodeJS.Timeout;
  notify: boolean;
  status: "pending" | "fired" | "cancelled";
  firedAt?: number;
}

const jobs = new Map<string, ScheduledJob>();
let nextJobId = 1;

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

interface ScheduleArgs {
  action: "set_timer" | "list" | "cancel";
  delay_seconds?: number;
  label?: string;
  message?: string;
  notify?: boolean;
  job_id?: string;
}

export const scheduleTool: ToolDefinition<ScheduleArgs> = {
  id: "schedule",
  title: "schedule",
  category: "workflow",
  description: [
    "Schedule timers and reminders in the background so you can monitor tasks over time without locking the conversation.",
    "Actions:",
    "- set_timer: Set a timer to trigger after `delay_seconds` (e.g. 300 for 5 min) with a message and desktop notification.",
    "- list: List all pending and recently completed scheduled timers.",
    "- cancel: Cancel an active timer by job_id.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["set_timer", "list", "cancel"], description: "Schedule action." },
      delay_seconds: { type: "number", description: "Delay in seconds before triggering (e.g. 60, 300, 600)." },
      label: { type: "string", description: "Short label for the timer (e.g. 'Vercel deploy check')." },
      message: { type: "string", description: "Notification message to show when timer fires." },
      notify: { type: "boolean", description: "Whether to display a system desktop notification when it fires (defaults to true)." },
      job_id: { type: "string", description: "Job ID to cancel (e.g. 'timer_1')." },
    },
    required: ["action"],
  },
  permission: null,
  readOnly: false,
  summarize: (a) => {
    if (a.action === "set_timer") return `timer in ${a.delay_seconds ?? 0}s: ${a.label ?? a.message ?? ""}`;
    if (a.action === "cancel") return `cancel ${a.job_id ?? ""}`;
    return "list timers";
  },
  async execute(args, ctx) {
    const { action } = args;

    if (action === "set_timer") {
      const delay = Math.max(1, Math.round(Number(args.delay_seconds) || 0));
      if (!delay) {
        return { output: "set_timer requires `delay_seconds` (e.g. delay_seconds: 60).", isError: true };
      }
      const id = `timer_${nextJobId++}`;
      const label = args.label || "Timer Alert";
      const message = args.message || `Timer for '${label}' has expired after ${delay}s.`;
      const shouldNotify = args.notify !== false;

      const triggerAt = Date.now() + delay * 1000;
      const job: ScheduledJob = {
        id,
        label,
        message,
        createdAt: Date.now(),
        triggerAt,
        notify: shouldNotify,
        status: "pending",
      };

      const handle = setTimeout(async () => {
        job.status = "fired";
        job.firedAt = Date.now();
        if (job.notify) {
          await sendNotification(job.label, job.message);
        }
        ctx.session.log("info", `[schedule] ${id} fired: ${job.message}`);
      }, delay * 1000);

      // Don't prevent process from exiting
      handle.unref?.();
      job.timerHandle = handle;
      jobs.set(id, job);

      const fireTime = new Date(triggerAt).toLocaleTimeString();
      return {
        output: `Scheduled ${id} ("${label}") to fire in ${delay} seconds (at ${fireTime}). ${shouldNotify ? "Desktop notification enabled." : ""}`,
      };
    }

    if (action === "list") {
      if (jobs.size === 0) return { output: "No scheduled timers." };
      const now = Date.now();
      const lines: string[] = ["Scheduled timers:"];
      for (const [id, j] of jobs.entries()) {
        if (j.status === "pending") {
          const remaining = Math.max(0, Math.round((j.triggerAt - now) / 1000));
          lines.push(`- [${id}] PENDING: "${j.label}" (fires in ${remaining}s at ${new Date(j.triggerAt).toLocaleTimeString()}) — ${j.message}`);
        } else if (j.status === "fired") {
          lines.push(`- [${id}] FIRED: "${j.label}" (at ${new Date(j.firedAt ?? 0).toLocaleTimeString()}) — ${j.message}`);
        } else {
          lines.push(`- [${id}] CANCELLED: "${j.label}"`);
        }
      }
      return { output: lines.join("\n") };
    }

    if (action === "cancel") {
      const id = args.job_id;
      if (!id || !jobs.has(id)) {
        return { output: `Job "${id ?? ""}" not found.`, isError: true };
      }
      const j = jobs.get(id)!;
      if (j.timerHandle) clearTimeout(j.timerHandle);
      j.status = "cancelled";
      return { output: `Cancelled timer ${id} ("${j.label}").` };
    }

    return { output: `Unknown action "${String(action)}". Use set_timer, list, or cancel.`, isError: true };
  },
};
