import type {
  Part,
  PermissionMode,
  PlanLimits,
  ProviderSettings,
  QuestionOption,
  SubagentInfo,
  SubscriptionInfo,
  TodoItem,
  ToolDisplay,
  ToolInfo,
} from "@nimbus/shared";

/** JSON Schema fragment used for tool parameters. */
export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolResult {
  /** Text handed back to the model. */
  output: string;
  /** Optional rich payload for UIs. */
  display?: ToolDisplay;
  isError?: boolean;
  /** Extra parts to append to the assistant message (images, questions…). */
  parts?: Part[];
  /** Images shown to the model with this result. Kept out of the stored tool text. */
  images?: { url: string }[];
}

export type ToolCategory = ToolInfo["category"];

/**
 * A tool definition. Mirrors Grok Build's "typed tool" contract: a stable id,
 * a client-facing name, a JSON schema, and an execute function that receives a
 * bound {@link ToolContext}.
 */
export interface ToolDefinition<A = Record<string, unknown>> {
  id: string;
  title: string;
  category: ToolCategory;
  /** Where the tool came from. Defaults from the id when omitted. */
  source?: "builtin" | "provider" | "mcp" | "composio";
  description: string;
  parameters: JsonSchema;
  /** Which permission prefix gates this tool (Bash, Edit, Write, Read, Grep, WebFetch, MCPTool, Computer). */
  permission: PermissionClass | null;
  /** Read-only tools stay enabled in plan/read_only mode. */
  readOnly: boolean;
  /** Short human summary of a call, shown in approval cards. */
  summarize?: (args: A) => string;
  /** Extract the glob subject for permission rules (command string, path, URL). */
  permissionSubject?: (args: A) => string;
  execute: (args: A, ctx: ToolContext) => Promise<ToolResult>;
}

export type PermissionClass = "Bash" | "Edit" | "Write" | "Read" | "Grep" | "WebFetch" | "MCPTool" | "Task" | "Computer";

export type PermissionDecision = "allow" | "ask" | "deny";

export interface ApprovalPrompt {
  toolCallId: string;
  toolName: string;
  title: string;
  summary: string;
  args: Record<string, unknown>;
}

export type ApprovalAnswer = "allow" | "allow_always" | "deny";

/** Live resources a tool can touch during one invocation. */
export interface ToolContext {
  cwd: string;
  workspaceRoot: string;
  dataDir: string;
  signal: AbortSignal;
  toolCallId: string;
  conversationId: string;
  session: SessionServices;
  /** Stream intermediate output (terminal chunks) to the UI. */
  progress: (chunk: string) => void;
}

/**
 * Host-provided services bound to the session — the analogue of Grok Build's
 * SessionContext. Tools never own global state; they borrow from here.
 */
export interface SessionServices {
  askUser(question: string, options: QuestionOption[], allowFreeform: boolean): Promise<string>;
  requestApproval(prompt: ApprovalPrompt): Promise<ApprovalAnswer>;
  setTodos(todos: TodoItem[]): void;
  getTodos(): TodoItem[];
  memory: MemoryStore;
  skills: SkillCatalog;
  subagents: SubagentCatalog;
  processes: ProcessManager;
  tasks: TaskManager;
  planMode: { active: boolean; enter(): void; exit(plan: string): Promise<boolean> };
  log: (level: "info" | "warn" | "error", msg: string, extra?: unknown) => void;
  settings: { webSearchEnabled: boolean; subagentsEnabled: boolean; provider: ProviderSettings };
  subscription?: SubscriptionInfo;
  limits?: PlanLimits;
  checkpoints: CheckpointStore;
  onSubagentsChanged?: () => void | Promise<void>;
}

export interface MemoryStore {
  read(scope: "global" | "workspace"): Promise<string>;
  append(scope: "global" | "workspace", text: string): Promise<void>;
}

export interface SkillCatalog {
  list(): Promise<{ name: string; description: string; path: string; scope: "local" | "repo" | "user" }[]>;
  load(name: string): Promise<string | null>;
}

export interface SubagentCatalog {
  list(): Promise<SubagentInfo[]>;
  load(name: string): Promise<SubagentInfo | null>;
}

export interface BackgroundProcess {
  id: string;
  command: string;
  startedAt: number;
  exitCode: number | null;
  output: string;
  done: Promise<void>;
  kill(): void;
}

export interface ProcessManager {
  start(command: string, cwd: string, env?: Record<string, string>): BackgroundProcess;
  get(id: string): BackgroundProcess | undefined;
  list(): BackgroundProcess[];
  killAll(): void;
}

export interface TaskRecord {
  id: string;
  kind: "subagent" | "process";
  subagentType?: string;
  description: string;
  status: "running" | "complete" | "error" | "cancelled";
  startedAt: number;
  endedAt?: number;
  output: string;
  toolCalls: number;
}

export interface TaskManager {
  spawnSubagent(input: { description: string; prompt: string; subagentType: string; background: boolean }): Promise<TaskRecord>;
  get(id: string): TaskRecord | undefined;
  wait(id: string, timeoutMs: number): Promise<TaskRecord | undefined>;
  list(): TaskRecord[];
}

export interface CheckpointStore {
  /** Snapshot a file before the agent edits it. */
  snapshot(path: string): Promise<void>;
}

export interface PermissionConfig {
  mode: PermissionMode;
  allow: string[];
  deny: string[];
  /** Per-session "allow always" grants keyed by tool id. */
  sessionAllow: Set<string>;
}

export interface HookDefinition {
  event: "PreToolUse" | "PostToolUse" | "SessionStart" | "SessionEnd";
  matcher?: string;
  command: string;
  timeoutMs?: number;
}

export interface HookResult {
  permission?: "allow" | "deny" | "ask";
  reason?: string;
  additionalContext?: string;
}
