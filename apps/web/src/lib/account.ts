import { clearCache } from "./db";

/** Active device token. Always the signed-in Google user's token, never another account's. */
export const TOKEN_KEY = "nimbus.token";
const TOKENS_KEY = "nimbus.tokens";
const CACHE_USER_KEY = "nimbus.cacheUser";

export function readTokenMap(): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [id, token] of Object.entries(parsed)) if (typeof token === "string" && token) out[id] = token;
    return out;
  } catch {
    return {};
  }
}

export function tokenForUser(userId: string): string | null {
  return readTokenMap()[userId] ?? null;
}

export function saveTokenForUser(userId: string, token: string) {
  const map = readTokenMap();
  map[userId] = token;
  localStorage.setItem(TOKENS_KEY, JSON.stringify(map));
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(CACHE_USER_KEY, userId);
}

export function forgetTokenForUser(userId: string) {
  const map = readTokenMap();
  delete map[userId];
  localStorage.setItem(TOKENS_KEY, JSON.stringify(map));
  const active = localStorage.getItem(TOKEN_KEY);
  if (active && !Object.values(map).includes(active)) localStorage.removeItem(TOKEN_KEY);
}

/**
 * A device token saved before accounts were separated.
 * Only the first Google user on this browser may claim it. Later accounts start empty.
 */
export function migratableToken(userId: string): string | null {
  const map = readTokenMap();
  if (map[userId] || Object.keys(map).length > 0) return null;
  return localStorage.getItem(TOKEN_KEY);
}

export async function prepareCache(userId: string) {
  const prev = localStorage.getItem(CACHE_USER_KEY);
  if (prev && prev !== userId) await clearCache();
  localStorage.setItem(CACHE_USER_KEY, userId);
}

export async function wipeLocalAccount(userId: string | undefined) {
  if (userId) forgetTokenForUser(userId);
  else localStorage.removeItem(TOKEN_KEY);
  await clearCache();
  localStorage.removeItem(CACHE_USER_KEY);
}
