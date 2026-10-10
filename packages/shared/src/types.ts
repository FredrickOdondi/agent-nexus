/**
 * Core domain model shared by the server, the agent runtime, the web client,
 * and the Electron shell. Everything that crosses a process boundary is defined here.
 */

export type Platform = "desktop" | "mobile" | "web";

export interface Space {
  id: string;
  name: string;
  createdAt: number;
}

export interface Device {
  id: string;
  spaceId: string;
  name: string;
  platform: Platform;
  primary: boolean;
  createdAt: number;
  lastSeenAt: number;
  online?: boolean;
}

export type AgentMode = "agent" | "plan" | "chat";

export interface Conversation {
  id: string;
  spaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
  /** Absolute path the agent operates in. Defaults to the space workspace. */
  workspacePath: string | null;
  mode: AgentMode;
  model: string | null;
  /** Last message preview for the sidebar. */
  preview: string;
  messageCount: number;
}

export type Role = "user" | "assistant" | "system";

export type MessageStatus = "complete" | "streaming" | "error" | "cancelled";

export type ToolCallStatus =
  | "pending"
  | "awaiting_approval"
  | "running"
  | "complete"
  | "error"
  | "denied"
  | "cancelled";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ReasoningPart {
  type: "reasoning";
  text: string;
  durationMs?: number;
}

export interface ToolCallPart {
  type: "tool_call";
  id: string;
  name: string;
  /** Pretty display name, e.g. "bash" for run_terminal_cmd. */
  title: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  /** Model-facing result (truncated for transport). */
  result?: string;
  /** Rich result for the UI (diff, terminal output, search results…). */
  display?: ToolDisplay;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  /** True when executed by the model provider (xAI server-side tools). */
  serverSide?: boolean;
}

export type ToolDisplay =
  | { kind: "terminal"; command: string; output: string; exitCode: number | null; cwd: string }
  | { kind: "diff"; path: string; before: string; after: string }
  | { kind: "file"; path: string; content: string; language?: string }
  | { kind: "search"; query: string; results: SearchResult[] }
  | { kind: "fetch"; url: string; title: string; excerpt: string }
  | { kind: "list"; path: string; entries: string[] }
  | { kind: "todos"; todos: TodoItem[] }
  | { kind: "task"; taskId: string; subagent: string; summary: string; status: string }
  | { kind: "memory"; scope: "global" | "workspace"; text: string }
  | { kind: "image"; url: string; prompt: string }
  | { kind: "plan"; mode: "enter" | "exit"; plan?: string }
  | { kind: "generic"; text: string };

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionPart {
  type: "question";
  id: string;
  question: string;
  options: QuestionOption[];
  allowFreeform: boolean;
  answer?: string;
  answeredBy?: string;
}

export interface Citation {
  url: string;
  title: string;
}

export interface CitationsPart {
  type: "citations";
  citations: Citation[];
}

export interface ImagePart {
  type: "image";
  url: string;
  alt?: string;
}

export interface ErrorPart {
  type: "error";
  message: string;
}

export type Part =
  | TextPart
  | ReasoningPart
  | ToolCallPart
  | QuestionPart
  | CitationsPart
  | ImagePart
  | ErrorPart;

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  parts: Part[];
  createdAt: number;
  updatedAt: number;
  status: MessageStatus;
  /** Device that authored a user message. */
  deviceId?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export type PermissionMode = "ask" | "auto" | "read_only" | "plan";

export type ProviderKind = "xai" | "openai_compatible" | "mock";

export interface ProviderSettings {
  kind: ProviderKind;
  /** Base URL, e.g. https://api.x.ai/v1 or http://localhost:11434/v1 */
  baseUrl: string;
  model: string;
  /** Present only server-side; clients receive `hasApiKey` instead. */
  apiKey?: string;
  hasApiKey?: boolean;
  /** Enable xAI server-side agent tools (web_search, x_search, code_interpreter). */
  serverTools: boolean;
}

export interface McpServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
}

export interface SpaceSettings {
  provider: ProviderSettings;
  permissionMode: PermissionMode;
  workspacePath: string;
  memoryEnabled: boolean;
  subagentsEnabled: boolean;
  webSearchEnabled: boolean;
  mcpServers: McpServerConfig[];
  /** Permission rules in Grok Build syntax, e.g. "Bash(git *)". */
  allowRules: string[];
  denyRules: string[];
  systemPromptAddendum: string;
}

export interface ToolInfo {
  id: string;
  title: string;
  category: "file" | "search" | "shell" | "workflow" | "external" | "custom";
  description: string;
  source: "builtin" | "provider" | "mcp";
  enabled: boolean;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  scope: "local" | "repo" | "user";
}

export interface ApprovalRequest {
  id: string;
  conversationId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  title: string;
  summary: string;
  args: Record<string, unknown>;
  createdAt: number;
}

export interface RunStatus {
  conversationId: string;
  state: "idle" | "thinking" | "tool" | "waiting_user";
  messageId?: string;
  detail?: string;
}

export interface PairingTicket {
  code: string;
  url: string;
  expiresAt: number;
}

export interface HealthInfo {
  ok: true;
  version: string;
  uptimeMs: number;
  dataDir: string;
  lanUrls: string[];
}
