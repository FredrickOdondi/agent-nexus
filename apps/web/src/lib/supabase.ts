import { createClient, type Session } from "@supabase/supabase-js";
import { DEFAULT_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_URL } from "@nimbus/shared";

const url = (import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, "");
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(url, key, {
  auth: {
    flowType: "pkce",
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});

export function accountFromSession(session: Session | null): { email: string; name: string; avatar: string } | null {
  const user = session?.user;
  if (!user) return null;
  const meta = user.user_metadata ?? {};
  const name = text(meta.full_name) || text(meta.name) || user.email || "Google account";
  const avatar = text(meta.avatar_url) || text(meta.picture);
  return { email: user.email ?? "", name, avatar };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Access token to send to the local server, refreshed when it is about to expire. */
export async function supabaseAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const session = data.session;
  if (!session) throw new Error("Sign in with Google first");
  const expiresAt = (session.expires_at ?? 0) * 1000;
  if (expiresAt > Date.now() + 30_000) return session.access_token;
  const refreshed = await supabase.auth.refreshSession();
  const token = refreshed.data.session?.access_token;
  if (!token) throw new Error("Your Google session expired. Sign in again.");
  return token;
}

export async function signInWithGoogle(): Promise<void> {
  if (location.hash) sessionStorage.setItem("nimbus.returnHash", location.hash);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${location.origin}/`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) throw error;
}
