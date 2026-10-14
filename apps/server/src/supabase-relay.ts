import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from "@nimbus/shared";
import type { ClientMessage, ServerMessage } from "@nimbus/shared";
import type { Db } from "./db.js";
import type { Hub, TransportConnection } from "./hub.js";
import type { SpaceRegistry } from "./registry.js";
import os from "node:os";

export class SupabaseRealtimeRelay {
  private client: SupabaseClient | null = null;
  private channels = new Map<string, RealtimeChannel>();
  private activeConns = new Map<string, TransportConnection>();

  constructor(
    private db: Db,
    private registry: SpaceRegistry,
    private hub: Hub,
    private log: (level: string, msg: string, extra?: unknown) => void,
  ) {
    this.init();
  }

  private init() {
    const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
    const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

    if (!url || !key) {
      this.log("warn", "Supabase credentials missing; remote realtime relay disabled");
      return;
    }

    try {
      this.client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: { params: { eventsPerSecond: 30 } },
      });
    } catch (e) {
      this.log("error", "Failed to initialize Supabase client for relay", (e as Error).message);
      return;
    }

    // Forward all Hub broadcasts (events and streaming deltas) to remote devices
    this.hub.onBroadcast((spaceId, msg) => {
      this.broadcastToRemote(spaceId, msg);
    });

    // Subscribe to all accounts in local database
    const accounts = this.db.listAccounts();
    for (const acc of accounts) {
      this.subscribeUser(acc.userId, acc.spaceId);
    }

    // Watch for new accounts created or bound at runtime
    this.registry.onAccount((userId, spaceId) => {
      this.subscribeUser(userId, spaceId);
    });

    this.registry.onSpace((rt) => {
      const acc = this.db.accountBySpace(rt.space.spaceId);
      if (acc) {
        this.subscribeUser(acc.userId, acc.spaceId);
      }
    });
  }

  subscribeUser(userId: string, spaceId: string) {
    if (!this.client || this.channels.has(userId)) return;

    const channelName = `nimbus:user:${userId}`;
    const channel = this.client.channel(channelName, {
      config: { broadcast: { ack: false, self: false } },
    });

    channel
      .on("broadcast", { event: "cmd" }, async ({ payload }) => {
        if (!payload || !payload.message) return;
        const deviceId = payload.deviceId || "remote-client";
        let conn = this.activeConns.get(deviceId);
        if (!conn) {
          conn = {
            device: null,
            send: (serverMsg: ServerMessage) => {
              channel.send({
                type: "broadcast",
                event: "msg",
                payload: { targetDeviceId: deviceId, message: serverMsg },
              });
            },
          };
          this.activeConns.set(deviceId, conn);
        }
        await this.hub.handleTransportMessage(conn, payload.message as ClientMessage);
      })
      .on("broadcast", { event: "bootstrap" }, async ({ payload }) => {
        if (payload?.userId === userId) {
          try {
            const dev = this.registry.ensureUserSpace({
              id: userId,
              email: payload.email || null,
              name: payload.deviceName || "Remote Phone",
              avatar: null,
            });
            channel.send({
              type: "broadcast",
              event: "bootstrap-res",
              payload: {
                requestId: payload.requestId,
                token: dev.token,
                deviceId: dev.deviceId,
                spaceId: dev.spaceId,
              },
            });
          } catch (err) {
            this.log("error", "remote bootstrap error", (err as Error).message);
          }
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          this.log("info", `Supabase Realtime Relay connected (${channelName})`);
          channel.track({
            isHost: true,
            platform: process.platform,
            hostname: os.hostname(),
            spaceId,
            onlineAt: Date.now(),
          });
        }
      });

    this.channels.set(userId, channel);
  }

  private broadcastToRemote(spaceId: string, msg: ServerMessage) {
    const acc = this.db.accountBySpace(spaceId);
    if (!acc) return;
    const channel = this.channels.get(acc.userId);
    if (!channel) return;

    channel.send({
      type: "broadcast",
      event: "msg",
      payload: { message: msg },
    });
  }

  close() {
    for (const ch of this.channels.values()) {
      ch.unsubscribe();
    }
    this.channels.clear();
  }
}
