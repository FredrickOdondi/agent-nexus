import type { ClientCommand, ServerMessage } from "@nimbus/shared";
import { supabase } from "./supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { bridge, isElectron } from "./platform";

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
  userId?: string | null;
  deviceId?: string | null;
}

/**
 * Resilient Hybrid Sync Client:
 * 1. Connects to local WebSocket when available on localhost/desktop.
 * 2. Seamlessly switches to Supabase Realtime Channel when remote (cellular, different Wi-Fi, travel).
 * 3. Supports request/ack correlation, reconnect backoff, and state recovery across both transports.
 */
export class SyncClient {
  private ws: WebSocket | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private transportMode: "ws" | "realtime" = "ws";
  private pending = new Map<string, Pending>();
  private attempt = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private counter = 0;
  private isOnline = false;

  constructor(private opts: ClientOptions) {}

  connect() {
    if (this.closed) return;
    this.opts.onState(this.attempt === 0 ? "connecting" : "offline");

    const isLocalHost = typeof window !== "undefined" && (
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1" ||
      isElectron ||
      Boolean(bridge?.isElectron)
    );

    // If on a remote deployment (e.g. Vercel) and we have a user account, use Realtime directly
    if (!isLocalHost && this.opts.userId) {
      this.connectRealtime();
      return;
    }

    this.connectWebSocket();
  }

  private connectWebSocket() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.transportMode = "ws";

    let connectionTimeout: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      // If local WebSocket does not open within 2.5s, fall back to Realtime if account exists
      if (ws.readyState !== WebSocket.OPEN && this.opts.userId) {
        ws.close();
        this.connectRealtime();
      }
    }, 2500);

    ws.onopen = () => {
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
      this.attempt = 0;
      ws.send(JSON.stringify({
        type: "hello",
        token: this.opts.token,
        since: this.opts.getSince(),
        deviceName: this.opts.deviceName,
      } satisfies ClientCommand));
    };

    ws.onmessage = (ev) => {
      try {
        const msg: ServerMessage = JSON.parse(ev.data);
        this.handleMessage(msg);
      } catch {
        /* ignore invalid payloads */
      }
    };

    ws.onclose = (ev) => {
      if (connectionTimeout) {
        clearTimeout(connectionTimeout);
        connectionTimeout = null;
      }
      this.isOnline = false;
      if (ev.code === 4001 || ev.code === 4002) {
        this.opts.onState("unauthorized");
        this.closed = true;
      }

      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("Connection lost"));
      }
      this.pending.clear();

      if (!this.closed) {
        // Fall back to Realtime on failure if we have a user account
        if (this.opts.userId) {
          this.connectRealtime();
        } else {
          this.opts.onState("offline");
          this.scheduleReconnect();
        }
      }
    };

    ws.onerror = () => {
      /* onclose handles retry */
    };
  }

  private connectRealtime() {
    if (!this.opts.userId || this.closed) {
      this.opts.onState("offline");
      this.scheduleReconnect();
      return;
    }

    this.transportMode = "realtime";
    const channelName = `nimbus:user:${this.opts.userId}`;
    this.opts.onState("connecting");

    if (this.realtimeChannel) {
      this.realtimeChannel.unsubscribe();
      this.realtimeChannel = null;
    }

    const channel = supabase.channel(channelName, {
      config: { broadcast: { ack: false, self: false } },
    });
    this.realtimeChannel = channel;

    channel
      .on("broadcast", { event: "msg" }, ({ payload }) => {
        if (!payload || !payload.message) return;
        const target = payload.targetDeviceId;
        if (target && this.opts.deviceId && target !== this.opts.deviceId) {
          return;
        }
        this.handleMessage(payload.message as ServerMessage);
      })
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const hasHost = Object.values(state).flat().some((p: any) => p.isHost);
        if (hasHost && !this.isOnline) {
          this.sendHelloRealtime();
        } else if (!hasHost && this.isOnline) {
          this.isOnline = false;
          this.opts.onState("offline");
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.track({
            isClient: true,
            platform: "remote-client",
            deviceName: this.opts.deviceName,
            onlineAt: Date.now(),
          });
          this.sendHelloRealtime();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          this.isOnline = false;
          this.opts.onState("offline");
          this.scheduleReconnect();
        }
      });
  }

  private sendHelloRealtime() {
    if (!this.realtimeChannel) return;
    this.realtimeChannel.send({
      type: "broadcast",
      event: "cmd",
      payload: {
        token: this.opts.token,
        deviceId: this.opts.deviceId || "remote-client",
        message: {
          type: "hello",
          token: this.opts.token,
          since: this.opts.getSince(),
          deviceName: this.opts.deviceName,
        } satisfies ClientCommand,
      },
    });
  }

  private handleMessage(msg: ServerMessage) {
    if (msg.type === "welcome") {
      this.isOnline = true;
      this.opts.onState("online");
    }

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
      this.close();
      return;
    }

    this.opts.onMessage(msg);
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

  nudge() {
    if (this.closed) return;
    if (this.isOnline) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connect();
  }

  get online() {
    return this.isOnline;
  }

  send<T = unknown>(cmd: ClientCommand, timeoutMs = 20_000): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const requestId = `${Date.now().toString(36)}_${++this.counter}`;
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("The desktop agent didn't respond in time. Ensure Nimbus is open on your computer."));
      }, timeoutMs);
      this.pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer });

      if (this.transportMode === "ws" && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ ...cmd, requestId }));
      } else if (this.transportMode === "realtime" && this.realtimeChannel) {
        this.realtimeChannel.send({
          type: "broadcast",
          event: "cmd",
          payload: {
            token: this.opts.token,
            deviceId: this.opts.deviceId || "remote-client",
            message: { ...cmd, requestId },
          },
        });
      } else {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error("You're offline. Reconnecting to your Nimbus desktop…"));
      }
    });
  }

  close() {
    this.closed = true;
    this.isOnline = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.realtimeChannel) {
      this.realtimeChannel.unsubscribe();
      this.realtimeChannel = null;
    }
  }
}
