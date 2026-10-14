import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scheduleTool } from "./schedule.js";
import { fileWatchTool } from "./watch.js";

function mockCtx(): any {
  return {
    cwd: process.cwd(),
    session: {
      log: () => {},
    },
    signal: new AbortController().signal,
  };
}

test("scheduleTool can set, list, and cancel a timer", async () => {
  const ctx = mockCtx();

  // 1. Set timer
  const setRes = await scheduleTool.execute(
    { action: "set_timer", delay_seconds: 60, label: "Test Timer", message: "Time is up", notify: false },
    ctx,
  );
  assert.equal(setRes.isError, undefined);
  assert.match(setRes.output, /Scheduled timer_\d+ \("Test Timer"\)/);

  // 2. List timers
  const listRes = await scheduleTool.execute({ action: "list" }, ctx);
  assert.match(listRes.output, /PENDING: "Test Timer"/);

  // Extract ID
  const match = listRes.output.match(/\[(timer_\d+)\]/);
  assert.ok(match);
  const timerId = match[1];

  // 3. Cancel timer
  const cancelRes = await scheduleTool.execute({ action: "cancel", job_id: timerId }, ctx);
  assert.match(cancelRes.output, new RegExp(`Cancelled timer ${timerId}`));
});

test("fileWatchTool can wait_for a pattern appended to a file", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nimbus-watch-"));
  const logFile = path.join(tmpDir, "build.log");
  await fs.writeFile(logFile, "Starting build...\n", "utf8");

  const ctx = { ...mockCtx(), cwd: tmpDir };

  // Append matching error after 200ms
  setTimeout(async () => {
    await fs.appendFile(logFile, "Line 1\nERROR: Out of memory\nLine 3\n", "utf8");
  }, 200);

  const res = await fileWatchTool.execute(
    { action: "wait_for", path: "build.log", pattern: "ERROR", timeout_seconds: 5 },
    ctx,
  );

  assert.equal(res.isError, undefined);
  assert.match(res.output, /Found pattern "ERROR"/);
  assert.match(res.output, /Out of memory/);

  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});
