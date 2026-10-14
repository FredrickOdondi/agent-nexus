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

export type ProviderKind = "deepseek" | "xai" | "openai_compatible" | "mock";

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
  /** When false, the agent does not receive connected-app tools. */
  composioEnabled: boolean;
  /** Present only server-side. Clients receive `hasComposioApiKey` and `composioKeySource`. */
  composioApiKey?: string;
  hasComposioApiKey?: boolean;
  composioKeySource?: ComposioKeySource;
  /** Stable Composio user id for this space. Server-side. */
  composioUserId?: string;
  /** Reused tool-router session. Server-side. */
  composioSessionId?: string;
}

/** An app the user can connect so the agent can act in it. */
export interface ComposioAppState {
  slug: string;
  name: string;
  blurb: string;
  logo?: string;
  /** First Composio category, used to group the directory. */
  category?: string;
  connected: boolean;
  noAuth: boolean;
}

export type ComposioKeySource = "settings" | "env" | "none";

export interface ToolInfo {
  id: string;
  title: string;
  category: "file" | "search" | "shell" | "workflow" | "external" | "custom";
  description: string;
  source: "builtin" | "provider" | "mcp" | "composio";
  enabled: boolean;
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  scope: "local" | "repo" | "user";
}

export interface SubagentInfo {
  name: string;
  description: string;
  path?: string;
  scope?: "local" | "repo" | "user" | "builtin";
  prompt?: string;
  tools?: string[];
  model?: string;
  avatar?: string;
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
  cloudUrl?: string;
}

export interface HealthInfo {
  ok: true;
  version: string;
  uptimeMs: number;
  dataDir: string;
  lanUrls: string[];
}

export type SubscriptionTier = "free" | "pro";

export type SubscriptionStatus = "free" | "trialing" | "active" | "past_due" | "canceled" | "expired";

export type BillingInterval = "month" | "year" | "lifetime";

export interface PlanLimits {
  /** Maximum number of paired devices allowed in a space. */
  maxDevices: number;
  /** Maximum number of custom subagents allowed. */
  maxSubagents: number;
  /** Maximum custom MCP servers allowed. */
  maxMcpServers: number;
  /** Maximum active Composio apps connected. */
  maxComposioApps: number;
  /** Autonomous background watchers / monitors (`watch`, `notify`). */
  backgroundWatchers: boolean;
  /** Encrypted cross-network sync relay / cloud backup. */
  cloudSync: boolean;
  /** Priority community and technical support. */
  prioritySupport: boolean;
}

export interface SubscriptionInfo {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  planName: string;
  billingInterval?: BillingInterval;
  trialStartedAt?: number;
  trialExpiresAt?: number;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  licenseKey?: string;
  customerEmail?: string;
  isTrialEligible: boolean;
  limits: PlanLimits;
}

export const FREE_PLAN_LIMITS: PlanLimits = {
  maxDevices: 2,
  maxSubagents: 2,
  maxMcpServers: 1,
  maxComposioApps: 1,
  backgroundWatchers: false,
  cloudSync: false,
  prioritySupport: false,
};

export const PRO_PLAN_LIMITS: PlanLimits = {
  maxDevices: 999,
  maxSubagents: 999,
  maxMcpServers: 999,
  maxComposioApps: 999,
  backgroundWatchers: true,
  cloudSync: true,
  prioritySupport: true,
};

export const TRIAL_DURATION_DAYS = 14;
export const TRIAL_DURATION_MS = TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000;

export const DEFAULT_FREE_SUBSCRIPTION: SubscriptionInfo = {
  tier: "free",
  status: "free",
  planName: "Nimbus Free",
  isTrialEligible: true,
  limits: FREE_PLAN_LIMITS,
};

/** Normalize subscription state: checks for trial expiry and ensures limits match tier. */
export function normalizeSubscription(sub?: Partial<SubscriptionInfo> | null): SubscriptionInfo {
  if (!sub) return { ...DEFAULT_FREE_SUBSCRIPTION };
  const now = Date.now();
  const rawStatus = sub.status ?? "free";

  // Check if 14-day trial has elapsed
  if (rawStatus === "trialing" && sub.trialExpiresAt && now > sub.trialExpiresAt) {
    return {
      ...sub,
      tier: "free",
      status: "expired",
      planName: "Nimbus Free (Trial Expired)",
      isTrialEligible: false,
      limits: FREE_PLAN_LIMITS,
    };
  }

  const isPro = sub.tier === "pro" && (rawStatus === "active" || rawStatus === "trialing");
  return {
    tier: isPro ? "pro" : "free",
    status: rawStatus,
    planName: sub.planName || (isPro ? "Nimbus Pro" : "Nimbus Free"),
    billingInterval: sub.billingInterval,
    trialStartedAt: sub.trialStartedAt,
    trialExpiresAt: sub.trialExpiresAt,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    licenseKey: sub.licenseKey,
    customerEmail: sub.customerEmail,
    isTrialEligible: sub.isTrialEligible ?? (rawStatus === "free" && !sub.trialStartedAt),
    limits: isPro ? PRO_PLAN_LIMITS : FREE_PLAN_LIMITS,
  };
}

