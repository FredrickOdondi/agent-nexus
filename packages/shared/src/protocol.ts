import type {
  ApprovalRequest,
  Conversation,
  Device,
  Message,
  Part,
  RunStatus,
  SkillInfo,
  SpaceSettings,
  ToolInfo,
} from "./types.js";

/**
 * WebSocket sync protocol.
 *
 * Every persisted mutation is assigned a monotonic `seq` within a space. Clients
 * remember the highest seq they've applied and ask for `since` on reconnect,
 * exactly like a message log replay. Streaming deltas are ephemeral (no seq)
 * and are superseded by the final `message.upsert`.
 */

export type SyncEvent =
  | { type: "conversation.upsert"; conversation: Conversation }
  | { type: "conversation.delete"; conversationId: string }
  | { type: "message.upsert"; message: Message }
  | { type: "message.delete"; messageId: string; conversationId: string }
  | { type: "settings.update"; settings: SpaceSettings }
  | { type: "device.upsert"; device: Device }
  | { type: "device.delete"; deviceId: string };

export interface PersistedEvent {
  seq: number;
  at: number;
  event: SyncEvent;
}

export type EphemeralEvent =
  | { type: "message.delta"; conversationId: string; messageId: string; partIndex: number; delta: string; partType: "text" | "reasoning" }
  | { type: "message.part"; conversationId: string; messageId: string; partIndex: number; part: Part }
  | { type: "run.status"; status: RunStatus }
  | { type: "approval.request"; request: ApprovalRequest }
  | { type: "approval.resolved"; requestId: string }
  | { type: "presence"; devices: Device[] }
  | { type: "toast"; level: "info" | "error" | "success"; text: string };

export type ServerMessage =
  | { type: "welcome"; deviceId: string; spaceId: string; seq: number; conversations: Conversation[]; settings: SpaceSettings; devices: Device[]; tools: ToolInfo[]; skills: SkillInfo[]; pendingApprovals: ApprovalRequest[]; runs: RunStatus[] }
  | { type: "events"; events: PersistedEvent[] }
  | { type: "event"; event: PersistedEvent }
  | { type: "ephemeral"; event: EphemeralEvent }
  | { type: "ack"; requestId: string; ok: true; result?: unknown }
  | { type: "ack"; requestId: string; ok: false; error: string }
  | { type: "error"; error: string };

export type ClientCommand =
  | { type: "hello"; token: string; since: number; deviceName?: string }
  | { type: "message.send"; conversationId: string | null; text: string; clientMessageId: string; mode?: Conversation["mode"]; workspacePath?: string | null }
  | { type: "message.regenerate"; conversationId: string; messageId: string }
  | { type: "run.cancel"; conversationId: string }
  | { type: "conversation.update"; conversationId: string; patch: Partial<Pick<Conversation, "title" | "pinned" | "archived" | "mode" | "model" | "workspacePath">> }
  | { type: "conversation.delete"; conversationId: string }
  | { type: "conversation.create"; title?: string; mode?: Conversation["mode"]; workspacePath?: string | null }
  | { type: "messages.fetch"; conversationId: string }
  | { type: "approval.respond"; requestId: string; decision: "allow" | "allow_always" | "deny" }
  | { type: "question.answer"; conversationId: string; messageId: string; questionId: string; answer: string }
  | { type: "settings.update"; patch: Partial<SpaceSettings> & { provider?: Partial<SpaceSettings["provider"]> } }
  | { type: "device.rename"; deviceId: string; name: string }
  | { type: "device.revoke"; deviceId: string }
  | { type: "rewind"; conversationId: string; messageId: string }
  | { type: "ping" };

export type ClientMessage = ClientCommand & { requestId?: string };

export const PROTOCOL_VERSION = 1;
