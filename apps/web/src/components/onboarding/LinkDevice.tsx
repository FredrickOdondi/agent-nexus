import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Loader2, Monitor, ShieldCheck, Smartphone, Wifi } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { DEVICE_NAME_KEY, TOKEN_KEY } from "@/lib/store";
import { defaultDeviceName, detectPlatform, isElectron } from "@/lib/platform";
import { cn } from "@/lib/utils";

interface Props {
  /** Pre-filled code from a `#/pair/123456` deep link (QR scan). */
  initialCode?: string;
  onLinked(): void;
}

type Phase = "probing" | "code" | "claiming" | "done";

/**
 * First-run screen. On the machine that runs the server (desktop app or a
 * local browser) we bootstrap the primary token silently. Everywhere else we
 * ask for the 6-digit pairing code shown in the desktop's Devices settings.
 */
export function LinkDevice({ initialCode, onLinked }: Props) {
  const [phase, setPhase] = useState<Phase>(initialCode ? "claiming" : "probing");
  const [digits, setDigits] = useState<string[]>(() => (initialCode ?? "").padEnd(6, " ").split("").map((d) => d.trim()));
  const [name, setName] = useState(() => localStorage.getItem(DEVICE_NAME_KEY) ?? defaultDeviceName());
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (initialCode) {
      // React StrictMode mounts twice, and a code can only be claimed once.
      // If this tab already redeemed it, skip straight into the app.
      if (sessionStorage.getItem("nimbus.claimedCode") === initialCode && localStorage.getItem(TOKEN_KEY)) {
        setPhase("done");
        onLinked();
        return;
      }
      void claim(initialCode);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/bootstrap", { headers: { accept: "application/json" } });
        if (res.ok) {
          const data = (await res.json()) as { token: string };
          if (cancelled) return;
          localStorage.setItem(TOKEN_KEY, data.token);
          localStorage.setItem(DEVICE_NAME_KEY, name);
          setPhase("done");
          onLinked();
          return;
        }
      } catch {
        /* server not reachable on loopback: fall through to code entry */
      }
      if (!cancelled) setPhase("code");
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function claim(code: string) {
    setPhase("claiming");
    setError(null);
    try {
      const res = await fetch("/api/pair/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, deviceName: name.trim() || defaultDeviceName(), platform: detectPlatform() }),
      });
      const data = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !data.token) throw new Error(data.error ?? "Pairing failed");
      localStorage.setItem(TOKEN_KEY, data.token);
      localStorage.setItem(DEVICE_NAME_KEY, name.trim() || defaultDeviceName());
      sessionStorage.setItem("nimbus.claimedCode", code);
      setPhase("done");
      toast.success("Device linked", { description: "Your chats will now stay in sync." });
      onLinked();
    } catch (e) {
      setError((e as Error).message);
      setPhase("code");
      setDigits(Array(6).fill(""));
      requestAnimationFrame(() => inputs.current[0]?.focus());
    }
  }

  function setDigit(i: number, value: string) {
    const clean = value.replace(/\D/g, "");
    if (!clean) {
      setDigits((d) => { const n = d.slice(); n[i] = ""; return n; });
      return;
    }
    setDigits((d) => {
      const n = d.slice();
      for (let k = 0; k < clean.length && i + k < 6; k++) n[i + k] = clean[k];
      return n;
    });
    const nextIdx = Math.min(5, i + clean.length);
    inputs.current[nextIdx]?.focus();
  }

  useEffect(() => {
    const code = digits.join("");
    if (phase === "code" && /^\d{6}$/.test(code)) void claim(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits]);

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-5 py-10 safe-top safe-bottom">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <motion.div className="absolute -top-20 left-1/2 size-[32rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 12, repeat: Infinity, ease: "easeInOut" }} />
        <motion.div className="absolute right-[-10%] bottom-[-10%] size-96 rounded-full bg-chart-2/15 blur-3xl" animate={{ x: [0, -20, 0], y: [0, 20, 0] }} transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }} />
      </div>
      <div className="absolute top-3 right-3 safe-top"><ThemeToggle /></div>

      <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 240, damping: 26 }} className="w-full max-w-md rounded-3xl border bg-card/80 p-6 text-card-foreground glass elevation-3 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-chart-2 text-lg font-bold text-primary-foreground elevation-2">N</div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Nimbus</h1>
            <p className="text-xs text-muted-foreground">Your agent, on every device</p>
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {phase === "probing" || phase === "done" ? (
            <motion.div key="probing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-3 py-8 text-center">
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">{isElectron ? "Starting your local agent…" : "Looking for a Nimbus server on this machine…"}</p>
            </motion.div>
          ) : (
            <motion.div key="code" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Link this device</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  On your desktop open <span className="font-medium text-foreground">Settings → Devices</span> and scan the QR code, or type the 6-digit code below. Messages sync instantly in both directions, like WhatsApp.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Pairing code</Label>
                <div className="flex justify-between gap-2" onPaste={(e) => { e.preventDefault(); setDigit(0, e.clipboardData.getData("text")); }}>
                  {digits.map((d, i) => (
                    <input
                      key={i}
                      ref={(el) => { inputs.current[i] = el; }}
                      inputMode="numeric"
                      autoComplete={i === 0 ? "one-time-code" : "off"}
                      pattern="[0-9]*"
                      maxLength={1}
                      value={d}
                      disabled={phase === "claiming"}
                      autoFocus={i === 0}
                      onChange={(e) => setDigit(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Backspace" && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
                        if (e.key === "ArrowLeft" && i > 0) inputs.current[i - 1]?.focus();
                        if (e.key === "ArrowRight" && i < 5) inputs.current[i + 1]?.focus();
                      }}
                      aria-label={`Digit ${i + 1}`}
                      className={cn(
                        "h-14 w-full rounded-xl border bg-background text-center font-mono text-2xl font-semibold tabular-nums shadow-xs outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:opacity-60",
                        error && "border-destructive",
                      )}
                    />
                  ))}
                </div>
                <AnimatePresence>
                  {error && <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="text-sm text-destructive">{error}</motion.p>}
                </AnimatePresence>
              </div>

              <div className="space-y-2">
                <Label htmlFor="device-name">Name this device</Label>
                <Input id="device-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pixel 9" maxLength={60} />
              </div>

              <Button className="w-full" size="lg" disabled={phase === "claiming" || !/^\d{6}$/.test(digits.join(""))} onClick={() => claim(digits.join(""))}>
                {phase === "claiming" ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                {phase === "claiming" ? "Linking…" : "Link device"}
              </Button>

              <ul className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
                <li className="rounded-xl bg-muted/60 p-2"><Wifi className="mx-auto mb-1 size-4 text-primary" />Same Wi‑Fi</li>
                <li className="rounded-xl bg-muted/60 p-2"><ShieldCheck className="mx-auto mb-1 size-4 text-primary" />Per‑device token</li>
                <li className="rounded-xl bg-muted/60 p-2"><Smartphone className="mx-auto mb-1 size-4 text-primary" /><Monitor className="mx-auto mb-1 hidden size-4" />Live sync</li>
              </ul>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
