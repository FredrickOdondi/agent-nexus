import { supabase } from "./supabase";

/**
 * When opening Nimbus from a phone on remote networks, automatically request
 * a linked device token from the user's online desktop instance via Supabase Realtime.
 */
export function requestRemoteBootstrap(userId: string, deviceName: string, timeoutMs = 6000): Promise<string | null> {
  return new Promise((resolve) => {
    const channelName = `nimbus:user:${userId}`;
    const requestId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;

    const channel = supabase.channel(channelName, {
      config: { broadcast: { ack: false, self: false } },
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      channel.unsubscribe();
      resolve(null);
    }, timeoutMs);

    channel
      .on("broadcast", { event: "bootstrap-res" }, ({ payload }) => {
        if (payload?.requestId === requestId && payload?.token) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          channel.unsubscribe();
          resolve(payload.token as string);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          channel.send({
            type: "broadcast",
            event: "bootstrap",
            payload: {
              userId,
              deviceName,
              requestId,
            },
          });
        }
      });
  });
}
