import type { ClientCommand, ServerMessage } from "@nimbus/shared";

export type ConnectionState = "connecting" | "online" | "offline" | "unauthorized";

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ClientOptions {
  token: string;
  deviceName: string;
  getSince: () => number;
  onMessage: (msg: ServerMessage) => void;
  onState: (state: ConnectionState) => void;
}

/**
 * Resilient WebSocket client: exponential backoff, request/ack correlation,
 * and automatic `hello { since }` replay on every (re)connect.
 */
export class SyncClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private attempt = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private counter = 0;

  constructor(private opts: ClientOptions) {}

  connect() {
    if (this.closed) return;
    this.opts.onState(this.attempt === 0 ? "connecting" : "offline");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      ws.send(JSON.stringify({ type: "hello", token: this.opts.token, since: this.opts.getSince(), deviceName: this.opts.deviceName } satisfies ClientCommand));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "welcome") this.opts.onState("online");
      if (msg.type === "ack") {
        const p = this.pending.get(msg.requestId);
        if (p) {
          this.pending.delete(msg.requestId);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.result);
          else p.reject(new Error(msg.error));
        }
        return;
      }
      if (msg.type === "error" && msg.error === "unauthorized") {
        this.opts.onState("unauthorized");
        this.closed = true;
        ws.close();
        return;
      }
      this.opts.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (ev.code === 4001) {
        this.opts.onState("unauthorized");
        this.closed = true;
      } else if (ev.code === 4002) {
        this.opts.onState("unauthorized");
        this.closed = true;
      }
      for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error("Connection lost")); }
      this.pending.clear();
      if (!this.closed) {
        this.opts.onState("offline");
        this.scheduleReconnect();
      }
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.attempt, 5)) + Math.random() * 300;
    this.attempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Force an immediate reconnect attempt (e.g. when the app regains focus). */
  nudge() {
    if (this.closed) return;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.connect();
  }

  get online() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send<T = unknown>(cmd: ClientCommand, timeoutMs = 15_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error("You're offline. Reconnecting…"));
      const requestId = `${Date.now().toString(36)}_${++this.counter}`;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("The server didn't respond in time."));
      }, timeoutMs);
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.ws.send(JSON.stringify({ ...cmd, requestId }));
    });
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
