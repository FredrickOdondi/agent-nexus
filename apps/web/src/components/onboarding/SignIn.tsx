import { useEffect, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { HardDrive, Loader2, Smartphone, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { authCodeFromRedirect, finishSignInWithCode, signInWithGoogle } from "@/lib/supabase";

const POINTS = [
  { icon: HardDrive, title: "The workspace stays here", body: "Files, commands, and the conversation run on this computer." },
  { icon: UserRound, title: "One Google account", body: "A different login opens an empty workspace. Nothing is shared." },
  { icon: Smartphone, title: "The phone is a second screen", body: "Pair it after you sign in. It joins this account over Wi-Fi." },
];

export function SignIn() {
  const [pending, setPending] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState("");
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
  const onPhone = location.hostname !== "localhost" && location.hostname !== "127.0.0.1";

  async function finish(event: FormEvent) {
    event.preventDefault();
    const code = authCodeFromRedirect(redirectUrl);
    if (!code) {
      setError("Paste the full address from the phone, the one that starts with http://127.0.0.1:47830/?code=");
      return;
    }
    setFinishing(true);
    setError(null);
    try {
      await finishSignInWithCode(code);
    } catch (e) {
      setFinishing(false);
      const message = e instanceof Error ? e.message : "Could not finish sign-in";
      setError(/verifier|code challenge|invalid|expired/i.test(message)
        ? "That sign-in expired, or this is a different browser than the one that opened Google. Stay on this page, tap Continue with Google, then paste the new address."
        : message);
    }
  }

  return (
    <div className="relative min-h-dvh bg-background lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1.15fr)_minmax(24rem,32rem)] lg:overflow-hidden">
      <DesktopStage />

      <div className="relative flex min-h-dvh flex-col overflow-y-auto px-5 py-8 safe-top safe-bottom sm:px-10 lg:h-full lg:min-h-0 lg:border-l lg:px-12">
        <div className="absolute top-4 right-4 z-10 safe-top">
          <ThemeToggle />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          className="m-auto w-full max-w-sm py-8"
        >
          <div className="mb-8 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-chart-2 text-lg font-bold text-primary-foreground elevation-2">
            N
          </div>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Use the Google account that should own this workspace. Chats stay on this computer.
          </p>

          <Button
            type="button"
            variant="outline"
            className="mt-8 h-12 w-full rounded-xl bg-background text-base elevation-1"
            disabled={pending}
            onClick={() => void start()}
          >
            {pending ? <Loader2 className="animate-spin" /> : <GoogleMark />}
            {pending ? "Opening Google…" : "Continue with Google"}
          </Button>
          <p className="mt-3 text-center text-xs text-muted-foreground">Opens Google in this browser, then returns here.</p>

          {onPhone && (
            <form onSubmit={(event) => void finish(event)} className="mt-8 space-y-3 border-t pt-6">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Google is sending this phone to 127.0.0.1, which is the computer, so that page cannot open. Copy the whole address from the phone and paste it here. Stay in this same browser.
              </p>
              <Textarea
                value={redirectUrl}
                onChange={(event) => setRedirectUrl(event.target.value)}
                placeholder="http://127.0.0.1:47830/?code=…"
                autoComplete="off"
                spellCheck={false}
                aria-label="Address from the phone"
                className="min-h-20 font-mono text-base"
              />
              <Button type="submit" className="h-12 w-full text-base" disabled={finishing || redirectUrl.trim().length === 0}>
                {finishing ? <Loader2 className="animate-spin" /> : null}
                {finishing ? "Finishing sign-in…" : "Finish sign-in"}
              </Button>
            </form>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm leading-relaxed text-destructive">
              {error}
              {redirectHint && " In the Supabase dashboard, add this page’s address under Authentication → URL configuration."}
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}

function DesktopStage() {
  return (
    <section className="relative hidden min-h-0 overflow-y-auto bg-sidebar lg:flex lg:h-full lg:flex-col lg:px-12 lg:py-8 xl:px-16" aria-hidden>
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-24 -left-16 size-[28rem] rounded-full bg-primary/15 blur-3xl"
          animate={{ scale: [1, 1.06, 1], x: [0, 16, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute right-[-8%] bottom-[-12%] size-[26rem] rounded-full bg-chart-2/15 blur-3xl"
          animate={{ x: [0, -18, 0], y: [0, 14, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="relative flex items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-chart-2 text-sm font-bold text-primary-foreground elevation-1">N</div>
        <span className="text-sm font-semibold tracking-tight">Nimbus</span>
      </div>

      <div className="relative max-w-xl [@media(min-height:860px)]:mt-4">
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 220, damping: 26 }}>
          <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">Desktop</p>
          <h2 className="mt-3 max-w-lg text-[2.35rem] leading-[1.05] font-semibold tracking-tight xl:text-5xl">
            The agent stays on this computer.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            Sign in once on the machine that holds your files. The phone follows the same Google account.
          </p>
        </motion.div>
        <ul className="mt-6 max-w-md space-y-3.5 xl:mt-8 xl:space-y-4">
          {POINTS.map((point, index) => (
            <motion.li
              key={point.title}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + index * 0.06, type: "spring", stiffness: 260, damping: 26 }}
              className="flex items-start gap-3"
            >
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-primary elevation-1">
                <point.icon className="size-4" />
              </span>
              <span>
                <span className="block text-sm font-medium">{point.title}</span>
                <span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{point.body}</span>
              </span>
            </motion.li>
          ))}
        </ul>
      </div>

      <WorkspacePreview />
    </section>
  );
}

function WorkspacePreview() {
  return (
    <div className="mt-auto shrink-0 pt-6">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.18, type: "spring", stiffness: 200, damping: 26 }}
        className="relative overflow-hidden rounded-2xl border bg-background elevation-3"
      >
        <div className="grid h-48 grid-cols-[10.5rem_1fr] [@media(min-height:900px)]:h-60 [@media(min-height:900px)]:grid-cols-[12rem_1fr]">
          <div className="flex flex-col border-r bg-sidebar p-3">
            <div className="flex items-center gap-2 px-1 pb-3">
              <span className="flex size-5 items-center justify-center rounded-md bg-gradient-to-br from-primary to-chart-2 text-[10px] font-bold text-primary-foreground">N</span>
              <span className="text-xs font-semibold">Nimbus</span>
              <span className="ml-auto size-1.5 rounded-full bg-success" />
            </div>
            <div className="mb-3 flex h-7 items-center rounded-lg bg-sidebar-accent/80 px-2 text-[10px] text-muted-foreground">Search</div>
            <PreviewRow title="Pair the phone" active={false} />
            <PreviewRow title="Desktop shell" active />
            <PreviewRow title="Today’s commits" active={false} />
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="flex h-10 items-center gap-2 border-b px-3">
              <span className="truncate text-xs font-medium">Desktop shell</span>
              <span className="rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground">agent</span>
            </div>
            <div className="flex flex-1 flex-col justify-end gap-2.5 px-3 py-3">
              <div className="ml-auto max-w-[78%] rounded-2xl rounded-br-md bg-bubble-user px-3 py-2 text-[11px] leading-relaxed text-bubble-user-foreground">
                Walk the repo and tell me where pairing starts.
              </div>
              <p className="max-w-[86%] text-[11px] leading-relaxed text-foreground">
                Pairing starts in Devices. The code opens this computer’s Wi-Fi address, and the phone joins the same account.
              </p>
            </div>
            <div className="mx-3 mb-3 flex h-9 items-center rounded-xl border bg-surface px-3 text-[11px] text-muted-foreground">
              Message Nimbus
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function PreviewRow({ title, active }: { title: string; active: boolean }) {
  return (
    <div className={`mb-1 truncate rounded-lg px-2 py-1.5 text-[11px] ${active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground"}`}>
      {title}
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
