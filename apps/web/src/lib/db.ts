import Dexie, { type Table } from "dexie";
import type { Conversation, Message } from "@nimbus/shared";

/**
 * Local-first cache. The UI renders from IndexedDB immediately and the sync
 * log replays anything missed since `meta.seq` — the same model WhatsApp uses
 * for multi-device: every device keeps its own copy, the server is the log.
 */
class NimbusCache extends Dexie {
  conversations!: Table<Conversation, string>;
  messages!: Table<Message, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor() {
    super("nimbus-cache");
    this.version(1).stores({
      conversations: "id, spaceId, updatedAt",
      messages: "id, conversationId, createdAt",
      meta: "key",
    });
  }
}

export const cache = new NimbusCache();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await cache.meta.get(key).catch(() => undefined);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown) {
  await cache.meta.put({ key, value }).catch(() => {});
}

export async function clearCache() {
  await Promise.all([cache.conversations.clear(), cache.messages.clear(), cache.meta.clear()]).catch(() => {});
}
