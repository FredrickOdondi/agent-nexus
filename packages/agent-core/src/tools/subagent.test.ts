import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSubagentCatalog } from "../discovery.js";
import { subagentManageTool } from "./subagent.js";

test("createSubagentCatalog lists built-in subagents by default", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nimbus-subagent-test-"));
  const catalog = createSubagentCatalog(tmpDir);
  const list = await catalog.list();

  const names = list.map((s) => s.name);
  assert.ok(names.includes("explore"));
  assert.ok(names.includes("review"));
  assert.ok(names.includes("plan"));
  assert.ok(names.includes("general"));

  const explore = await catalog.load("explore");
  assert.ok(explore);
  assert.equal(explore.name, "explore");
  assert.equal(explore.scope, "builtin");
  assert.ok(explore.tools?.includes("grep"));
});

test("subagentManageTool can create, list, read, and delete custom subagents", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nimbus-subagent-test-"));
  const catalog = createSubagentCatalog(tmpDir);

  const ctx: any = {
    cwd: tmpDir,
    session: {
      subagents: catalog,
      planMode: { active: false },
      log: () => {},
    },
  };

  // 1. Create a custom subagent file directly in tmpDir/.nimbus/subagents/
  const subagentDir = path.join(tmpDir, ".nimbus", "subagents");
  await fs.mkdir(subagentDir, { recursive: true });
  const mdPath = path.join(subagentDir, "code-auditor.md");
  await fs.writeFile(
    mdPath,
    `---
name: code-auditor
description: "Scans for security vulnerabilities and type traps"
tools: glob, grep, read_file
model: deepseek-reasoner
---
You are a senior security and performance auditor. Inspect all inputs and dependencies thoroughly.`,
    "utf8",
  );

  // 2. Scan catalog
  const listAfter = await catalog.list();
  const auditor = listAfter.find((s) => s.name === "code-auditor");
  assert.ok(auditor);
  assert.equal(auditor.description, "Scans for security vulnerabilities and type traps");
  assert.deepEqual(auditor.tools, ["glob", "grep", "read_file"]);
  assert.equal(auditor.model, "deepseek-reasoner");
  assert.match(auditor.prompt ?? "", /senior security and performance auditor/);

  // 3. Read via subagentManageTool
  const readRes = await subagentManageTool.execute({ action: "read", name: "code-auditor" }, ctx);
  assert.equal(readRes.isError, undefined);
  assert.match(readRes.output, /Subagent: \/code-auditor/);
  assert.match(readRes.output, /Tools: glob, grep, read_file/);

  // 4. Delete via subagentManageTool
  const deleteRes = await subagentManageTool.execute({ action: "delete", name: "code-auditor" }, ctx);
  assert.equal(deleteRes.isError, undefined);
  assert.match(deleteRes.output, /Deleted custom subagent 'code-auditor'/);

  // Verify file removed
  const listFinal = await catalog.list();
  assert.equal(listFinal.find((s) => s.name === "code-auditor"), undefined);
});

test("subagentManageTool enforces 2 custom subagents limit on Free plan", async () => {
  const customAgents: any[] = [];
  const mockCatalog: any = {
    list: async () => [...customAgents],
    load: async (name: string) => customAgents.find((a) => a.name === name) ?? null,
  };

  const ctx: any = {
    cwd: await fs.mkdtemp(path.join(os.tmpdir(), "nimbus-limit-")),
    session: {
      subagents: mockCatalog,
      planMode: { active: false },
      log: () => {},
      subscription: { tier: "free", status: "active", planName: "Nimbus Free", limits: { maxSubagents: 2 } },
      limits: { maxSubagents: 2 },
    },
  };

  // Agent 1 -> OK
  const res1 = await subagentManageTool.execute(
    { action: "create", name: "agent-one", description: "first subagent", prompt: "You are agent 1." },
    ctx,
  );
  assert.equal(res1.isError, undefined);
  customAgents.push({ name: "agent-one", description: "first subagent", scope: "local" });

  // Agent 2 -> OK
  const res2 = await subagentManageTool.execute(
    { action: "create", name: "agent-two", description: "second subagent", prompt: "You are agent 2." },
    ctx,
  );
  assert.equal(res2.isError, undefined);
  customAgents.push({ name: "agent-two", description: "second subagent", scope: "local" });

  // Agent 3 -> BLOCKED!
  const res3 = await subagentManageTool.execute(
    { action: "create", name: "agent-three", description: "third subagent", prompt: "You are agent 3." },
    ctx,
  );
  assert.equal(res3.isError, true);
  assert.match(res3.output, /SUBSCRIPTION LIMIT REACHED/);
  assert.match(res3.output, /limited to 2 custom subagents/);
});

