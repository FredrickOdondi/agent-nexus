import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { signInWithGoogle } from "@/lib/supabase";

export function SignIn() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const message = params.get("error_description") || params.get("error");
    if (!message) return;
    params.delete("error");
    params.delete("error_description");
    params.delete("error_code");
    const search = params.toString();
    history.replaceState(null, "", `${location.pathname}${search ? `?${search}` : ""}${location.hash}`);
    setError(decodeURIComponent(message.replace(/\+/g, " ")));
  }, []);

  async function start() {
    setPending(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setPending(false);
      setError(e instanceof Error ? e.message : "Could not start Google sign-in");
    }
  }

  const redirectHint = error && /redirect/i.test(error);

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-5 py-10 safe-top safe-bottom">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <motion.div className="absolute -top-20 left-1/2 size-[32rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div className="absolute right-[-10%] bottom-[-10%] size-96 rounded-full bg-chart-2/15 blur-3xl" animate={{ x: [0, -20, 0], y: [0, 20, 0] }} transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }} />
      </div>
      <div className="absolute top-3 right-3 safe-top"><ThemeToggle /></div>

      <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 240, damping: 26 }} className="w-full max-w-md p-1 text-card-foreground sm:rounded-3xl sm:border sm:bg-card/80 sm:p-8 sm:glass sm:elevation-3">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-chart-2 text-lg font-bold text-primary-foreground elevation-2">N</div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Nimbus</h1>
            <p className="text-xs text-muted-foreground">Your agent, on every device</p>
          </div>
        </div>

        <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Use the same Google account on your computer and your phone. Chats stay on this computer and sync across the devices you link.
        </p>

        <Button type="button" variant="outline" className="mt-6 h-12 w-full rounded-xl bg-background text-base" disabled={pending} onClick={() => void start()}>
          {pending ? <Loader2 className="animate-spin" /> : <GoogleMark />}
          {pending ? "Opening Google…" : "Continue with Google"}
        </Button>

        {error && (
          <p className="mt-4 text-sm leading-relaxed text-destructive">
            {error}
            {redirectHint && " In the Supabase dashboard, add this page’s address under Authentication → URL configuration."}
          </p>
        )}
      </motion.div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.7-6.6 7.1l.1.1 6.3 5.3C36.9 41.6 44 36 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}
