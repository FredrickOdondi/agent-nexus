import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from "@nimbus/shared";

export interface SupabaseAccount {
  id: string;
  email: string | null;
  name: string | null;
  avatar: string | null;
}

function project(): { url: string; key: string } {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
  return { url, key };
}

/** Confirm a browser access token with Supabase Auth. Returns null when it is missing or rejected. */
export async function verifySupabaseAccessToken(accessToken: string | undefined | null): Promise<SupabaseAccount | null> {
  const token = accessToken?.trim();
  if (!token) return null;
  const { url, key } = project();
  let res: Response;
  try {
    res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const user = (await res.json().catch(() => null)) as { id?: string; email?: string; user_metadata?: Record<string, unknown> } | null;
  if (!user?.id) return null;
  const meta = user.user_metadata ?? {};
  const name = stringMeta(meta.full_name) || stringMeta(meta.name);
  const avatar = stringMeta(meta.avatar_url) || stringMeta(meta.picture);
  return { id: user.id, email: user.email?.trim() || null, name, avatar };
}

function stringMeta(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
