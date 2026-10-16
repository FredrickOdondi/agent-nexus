/**
 * Public Supabase project used for Google sign-in.
 * The publishable key is meant for the browser. Never put a secret or service-role key here.
 * Override with VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (client) or SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY (server).
 */
export const DEFAULT_SUPABASE_URL = "https://vaqbuldbiyexxeobnnal.supabase.co";
export const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_3JoMEJ8nnGElhXrrB8YYGg_26jFCgDH";

/** Default public Cloudflare R2 bucket URL for desktop installers and updates */
export const DEFAULT_R2_RELEASES_URL = "https://pub-ce50cd78e02245c4afb325681955755a.r2.dev";

/** Build the public download URL for a release artifact (hosted on Cloudflare R2) */
export function getReleaseUrl(
  filename: string,
  baseUrl = DEFAULT_R2_RELEASES_URL
): string {
  const cleanBase = baseUrl.replace(/\/$/, "");
  return `${cleanBase}/${filename}`;
}

/** Default public bucket name for desktop installers and updates */
export const DEFAULT_SUPABASE_RELEASES_BUCKET = "releases";

/** Build the public Supabase Storage URL for a release artifact */
export function getSupabaseReleaseUrl(
  filename: string,
  baseUrl = DEFAULT_SUPABASE_URL,
  bucket = DEFAULT_SUPABASE_RELEASES_BUCKET
): string {
  const cleanBase = baseUrl.replace(/\/$/, "");
  return `${cleanBase}/storage/v1/object/public/${bucket}/${filename}`;
}

export const DEFAULT_RELEASE_FILES = {
  macUniversal: "Nimbus-0.1.1-universal.dmg",
  macUniversalLatest: "Nimbus-universal.dmg",
  windowsSetup: "Nimbus.Setup.0.1.1.exe",
  windowsSetupLatest: "Nimbus-Setup.exe",
  latestMacYml: "latest-mac.yml",
  latestWindowsYml: "latest.yml",
} as const;

