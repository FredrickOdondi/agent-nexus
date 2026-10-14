import { useEffect, useState } from "react";
import {
  Check,
  Clock,
  Crown,
  KeyRound,
  Loader2,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStore, TOKEN_KEY } from "@/lib/store";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Section } from "../SettingsDialog";
import { TRIAL_DURATION_DAYS } from "@nimbus/shared";

export function SubscriptionTab() {
  const subscription = useStore((s) => s.subscription);
  const startTrial = useStore((s) => s.startTrial);
  const activateLicense = useStore((s) => s.activateLicense);

  const [licenseKeyInput, setLicenseKeyInput] = useState("");
  const [activating, setActivating] = useState(false);
  const [trialing, setTrialing] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<"month" | "year">("month");

  const isPro = subscription?.tier === "pro";
  const isTrial = subscription?.status === "trialing";
  const isExpired = subscription?.status === "expired";
  const isLifetime = Boolean(
    subscription?.billingInterval === "lifetime" ||
    subscription?.planName?.toLowerCase().includes("lifetime") ||
    subscription?.licenseKey?.toUpperCase().includes("LIFE")
  );
  const isAnnual = Boolean(
    isPro && !isTrial && !isLifetime &&
    (subscription?.billingInterval === "year" || subscription?.planName?.toLowerCase().includes("annual"))
  );
  const isMonthly = Boolean(isPro && !isTrial && !isLifetime && !isAnnual);
  const isFree = !isPro || isExpired;
  const isCurrentPro = isPro && !isLifetime;

  // Auto-verify Paystack transaction reference on redirect back
  useEffect(() => {
    const rawSearch = window.location.search || window.location.hash.split("?")[1] || "";
    const params = new URLSearchParams(rawSearch);
    const reference = params.get("reference") || params.get("trxref");

    if (reference) {
      const verify = async () => {
        try {
          const token = localStorage.getItem(TOKEN_KEY);
          const res = await fetch("/api/subscription/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ reference }),
          });
          const data = await res.json();
          if (data.ok && data.subscription) {
            toast.success("Payment confirmed with Paystack! Welcome to Nimbus Pro.");
            // Clean query parameters from URL
            const cleanHash = window.location.hash.split("?")[0];
            window.history.replaceState({}, document.title, window.location.pathname + cleanHash);
          }
        } catch {
          // ignore error
        }
      };
      void verify();
    }
  }, []);

  // Calculate days remaining in trial
  const daysRemaining = subscription?.trialExpiresAt
    ? Math.max(0, Math.ceil((subscription.trialExpiresAt - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const handleStartTrial = async () => {
    setTrialing(true);
    try {
      await startTrial();
    } finally {
      setTrialing(false);
    }
  };

  const handleActivate = async () => {
    if (!licenseKeyInput.trim()) return;
    setActivating(true);
    try {
      await activateLicense(licenseKeyInput.trim());
      setLicenseKeyInput("");
    } finally {
      setActivating(false);
    }
  };

  const handleCheckout = async (planId: "monthly" | "annual" | "lifetime") => {
    setCheckingOut(planId);
    try {
      const token = localStorage.getItem(TOKEN_KEY);
      const mappedPlanId = planId === "lifetime" ? "pro_lifetime" : planId === "annual" ? "pro_annual" : "pro_monthly";
      const res = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ planId: mappedPlanId }),
      });
      const data = await res.json();
      if (!res.ok || !data.authorizationUrl) {
        throw new Error(data.error || "Failed to initialize Paystack checkout");
      }
      // Redirect to Paystack secure checkout
      window.location.href = data.authorizationUrl;
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCheckingOut(null);
    }
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Current Plan Overview Banner */}
      <div className={cn(
        "relative overflow-hidden rounded-2xl border p-5 transition-all",
        isLifetime
          ? "border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-background shadow-xs"
          : isPro
          ? "border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-background"
          : "border-border bg-card/60"
      )}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide uppercase",
                isLifetime
                  ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/40"
                  : isTrial
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                  : isPro
                  ? "bg-primary/20 text-primary border border-primary/30"
                  : "bg-muted text-muted-foreground border border-border"
              )}>
                {isLifetime ? <Crown className="size-3.5 text-amber-500" /> : isTrial ? <Clock className="size-3.5" /> : isPro ? <Crown className="size-3.5" /> : <Zap className="size-3.5" />}
                {isLifetime ? "Founder's Lifetime Pass" : isTrial ? "Nimbus Pro (Trial)" : isAnnual ? "Nimbus Pro (Annual)" : isMonthly ? "Nimbus Pro (Monthly)" : "Nimbus Free"}
              </span>
              <span className="text-xs text-muted-foreground font-medium">
                {isLifetime
                  ? "• Lifetime access"
                  : isTrial
                  ? `• ${daysRemaining} days left in trial`
                  : isAnnual
                  ? "• Billed annually"
                  : isMonthly
                  ? "• Billed monthly"
                  : "• Free plan"}
              </span>
            </div>

            <h3 className="text-lg font-semibold tracking-tight">
              {isLifetime
                ? "Founder's Lifetime Pass Active"
                : isTrial
                ? `${daysRemaining} days remaining in your Pro Trial`
                : isAnnual
                ? "Nimbus Pro (Annual) Active"
                : isMonthly
                ? "Nimbus Pro Active"
                : isExpired
                ? "Your 14-day trial has concluded"
                : "Nimbus Free Plan Active"}
            </h3>

            <p className="text-sm text-muted-foreground max-w-xl">
              {isLifetime
                ? "All Pro features unlocked forever with zero recurring bills. Unlimited devices, subagents, and background monitors."
                : isTrial
                ? `You are enjoying full access to unlimited devices, subagents, and background monitors. Trial ends on ${new Date(subscription?.trialExpiresAt || 0).toLocaleDateString()}.`
                : isPro
                ? "You have unlimited multi-device pairing, background watchers, and unlimited subagents."
                : "Free local-first BYOK plan with up to 2 devices and 2 custom subagents. Upgrade to Pro for unlimited multi-device sync, background watchers, and subagents."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {isFree && subscription?.isTrialEligible && (
              <Button
                onClick={handleStartTrial}
                disabled={trialing}
                className="gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white shadow-sm font-medium"
              >
                <Sparkles className="size-4" />
                {trialing ? "Activating Trial…" : `Start ${TRIAL_DURATION_DAYS}-Day Pro Trial`}
              </Button>
            )}

            {isFree && !subscription?.isTrialEligible && (
              <Button
                onClick={() => handleCheckout("monthly")}
                className="gap-2 bg-primary text-primary-foreground shadow-sm font-medium"
              >
                <Crown className="size-4" />
                Upgrade to Pro
              </Button>
            )}

            {isTrial && (
              <Button
                onClick={() => handleCheckout(billingInterval === "year" ? "annual" : "monthly")}
                className="gap-2 bg-primary text-primary-foreground shadow-sm font-medium"
              >
                <Crown className="size-4" />
                Subscribe Now
              </Button>
            )}

            {isPro && !isLifetime && (
              <Button
                variant="outline"
                onClick={() => handleCheckout("lifetime")}
                className="gap-2 border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400 font-medium"
              >
                <Crown className="size-4 text-amber-500" />
                Upgrade to Lifetime ($129)
              </Button>
            )}

            {isLifetime && subscription?.licenseKey && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-right">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">License Key</span>
                <span className="font-mono text-xs font-semibold text-foreground">{subscription.licenseKey}</span>
              </div>
            )}
          </div>
        </div>

        {/* Trial Progress Bar */}
        {isTrial && subscription?.trialStartedAt && subscription?.trialExpiresAt && (
          <div className="mt-4 pt-3 border-t border-border/50">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
              <span>14-day trial period</span>
              <span className="font-medium text-foreground">{daysRemaining} days remaining</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(5, ((subscription.trialExpiresAt - Date.now()) / (14 * 24 * 60 * 60 * 1000)) * 100))}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Plan Comparison & Pricing Cards */}
      <section className="mb-7">
        {/* Billing Interval Toggle */}
        <div className="flex items-center justify-center gap-2 pb-2">
          <div className="inline-flex items-center rounded-xl bg-muted p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setBillingInterval("month")}
              className={cn(
                "rounded-lg px-3 py-1.5 transition-colors",
                billingInterval === "month"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setBillingInterval("year")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors",
                billingInterval === "year"
                  ? "bg-background text-foreground shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Annual
              <span className="rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.2 text-[10px] font-bold">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {/* Free Tier */}
          <div className={cn(
            "relative flex flex-col rounded-2xl border p-4.5 transition-all bg-card/40",
            isFree ? "border-primary/50 ring-2 ring-primary/20 bg-card shadow-xs" : "border-border opacity-75"
          )}>
            {isFree && (
              <div className="absolute -top-2.5 right-4 rounded-full bg-muted border border-border px-2.5 py-0.5 text-[10px] font-bold text-foreground shadow-xs uppercase tracking-wider">
                Current Plan
              </div>
            )}

            <div className="mb-4">
              <h4 className="text-base font-semibold">Free</h4>
              <p className="mt-1 text-xs text-muted-foreground">For personal BYOK local-first agent workflows.</p>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight">$0</span>
                <span className="text-xs text-muted-foreground">/ forever</span>
              </div>
            </div>

            <ul className="space-y-2.5 text-xs text-muted-foreground mb-6 flex-1">
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-emerald-500 mt-0.5" />
                <span>Bring your own models (Ollama, OpenAI, DeepSeek, xAI)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-emerald-500 mt-0.5" />
                <span>Local SQLite zero-knowledge storage</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-emerald-500 mt-0.5" />
                <span>Up to <strong>2 connected devices</strong> (Desktop + Phone)</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-emerald-500 mt-0.5" />
                <span>Up to <strong>2 custom subagents</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-emerald-500 mt-0.5" />
                <span>1 active MCP / Composio app</span>
              </li>
            </ul>

            <Button
              variant={isFree ? "secondary" : "outline"}
              className="w-full text-xs h-9 cursor-default"
              disabled={isFree}
            >
              {isFree ? "Current Plan" : "Downgrade to Free"}
            </Button>
          </div>

          {/* Pro Tier */}
          <div className={cn(
            "relative flex flex-col rounded-2xl border p-4.5 transition-all bg-card shadow-sm",
            isCurrentPro
              ? "border-primary ring-2 ring-primary/25"
              : isLifetime
              ? "border-border opacity-75"
              : "border-primary/40"
          )}>
            {isCurrentPro ? (
              <div className="absolute -top-2.5 right-4 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-bold text-primary-foreground shadow-xs uppercase tracking-wider">
                Current Plan{isTrial ? " (Trial)" : ""}
              </div>
            ) : !isLifetime ? (
              <div className="absolute -top-2.5 right-4 rounded-full bg-gradient-to-r from-primary to-orange-500 px-2.5 py-0.5 text-[10px] font-bold text-white shadow-xs uppercase tracking-wider">
                Most Popular
              </div>
            ) : null}

            <div className="mb-4">
              <h4 className="text-base font-semibold flex items-center gap-1.5">
                Pro <Sparkles className="size-3.5 text-amber-500" />
              </h4>
              <p className="mt-1 text-xs text-muted-foreground">Uncapped multi-device speed and automation.</p>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight">
                  {billingInterval === "month" ? "$9" : "$89"}
                </span>
                <span className="text-xs text-muted-foreground">
                  /{billingInterval === "month" ? "month" : "year ($7.40/mo)"}
                </span>
              </div>
            </div>

            <ul className="space-y-2.5 text-xs text-muted-foreground mb-6 flex-1">
              <li className="flex items-start gap-2 text-foreground font-medium">
                <Check className="size-4 shrink-0 text-primary mt-0.5" />
                <span>Everything in Free, plus:</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-primary mt-0.5" />
                <span><strong>Unlimited connected devices</strong> & Wi-Fi sync</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-primary mt-0.5" />
                <span><strong>Unlimited custom subagents</strong> & custom prompts</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-primary mt-0.5" />
                <span><strong>Unlimited MCP servers</strong> & connected apps</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-primary mt-0.5" />
                <span>Autonomous <strong>background watchers & notify</strong></span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-primary mt-0.5" />
                <span>Encrypted cross-network sync relay</span>
              </li>
            </ul>

            <Button
              onClick={() => handleCheckout(billingInterval === "month" ? "monthly" : "annual")}
              disabled={checkingOut !== null || isLifetime || (isCurrentPro && !isTrial)}
              variant={isCurrentPro && !isTrial ? "secondary" : "default"}
              className={cn(
                "w-full text-xs h-9 font-medium gap-1.5",
                isLifetime
                  ? "bg-muted text-muted-foreground border border-border cursor-default"
                  : isCurrentPro && !isTrial
                  ? "bg-muted text-foreground border border-border/80 cursor-default"
                  : "bg-primary text-primary-foreground"
              )}
            >
              {checkingOut === (billingInterval === "month" ? "monthly" : "annual") ? (
                <><Loader2 className="size-3.5 animate-spin" /> Redirecting to Paystack…</>
              ) : isLifetime ? (
                "Included in Lifetime"
              ) : isCurrentPro && !isTrial ? (
                "Current Plan"
              ) : isCurrentPro && isTrial ? (
                `Subscribe to Pro (${billingInterval === "month" ? "$9/mo" : "$89/yr"})`
              ) : (
                `Get Pro (${billingInterval === "month" ? "$9/mo" : "$89/yr"})`
              )}
            </Button>
          </div>

          {/* Founder's Lifetime Pass */}
          <div className={cn(
            "relative flex flex-col rounded-2xl border p-4.5 transition-all bg-card/60",
            isLifetime
              ? "border-amber-500 ring-2 ring-amber-500/30 bg-card shadow-sm"
              : "border-amber-500/40 hover:border-amber-500/70"
          )}>
            {isLifetime ? (
              <div className="absolute -top-2.5 right-4 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-2.5 py-0.5 text-[10px] font-bold text-white shadow-xs uppercase tracking-wider flex items-center gap-1">
                <Crown className="size-3" /> Current Plan
              </div>
            ) : (
              <div className="absolute -top-2.5 right-4 rounded-full bg-muted border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-500 uppercase tracking-wider">
                Founder Access
              </div>
            )}

            <div className="mb-4">
              <h4 className="text-base font-semibold flex items-center gap-1.5">
                Lifetime <Crown className="size-3.5 text-amber-500" />
              </h4>
              <p className="mt-1 text-xs text-muted-foreground">Pay once, own Nimbus Pro forever.</p>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-bold tracking-tight">$129</span>
                <span className="text-xs text-muted-foreground">/ one-time</span>
              </div>
            </div>

            <ul className="space-y-2.5 text-xs text-muted-foreground mb-6 flex-1">
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-amber-500 mt-0.5" />
                <span><strong>All Pro features</strong> across all current & future devices</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-amber-500 mt-0.5" />
                <span><strong>Lifetime software updates</strong> & early beta access</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-amber-500 mt-0.5" />
                <span>Zero recurring subscription bills forever</span>
              </li>
              <li className="flex items-start gap-2">
                <Check className="size-4 shrink-0 text-amber-500 mt-0.5" />
                <span>Founder badge & direct roadmap feedback</span>
              </li>
            </ul>

            <Button
              variant={isLifetime ? "secondary" : "outline"}
              onClick={() => !isLifetime && handleCheckout("lifetime")}
              disabled={checkingOut !== null || isLifetime}
              className={cn(
                "w-full text-xs h-9 font-medium gap-1.5",
                isLifetime
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 cursor-default"
                  : "border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-600 dark:hover:text-amber-400"
              )}
            >
              {checkingOut === "lifetime" ? (
                <><Loader2 className="size-3.5 animate-spin" /> Redirecting to Paystack…</>
              ) : isLifetime ? (
                <>
                  <Crown className="size-3.5" />
                  Current Plan (Lifetime)
                </>
              ) : (
                "Get Lifetime Pass ($129)"
              )}
            </Button>
          </div>
        </div>

        {/* Security / Gateway callout */}
        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-emerald-500" />
          <span>Payments secured with 256-bit encryption by <strong>Paystack</strong></span>
        </div>
      </section>

      {/* License Key Activation Section */}
      <Section
        title="Activate License Key"
        description="Already purchased via Polar, Lemon Squeezy, or received a Founder key? Enter it below to unlock Pro."
      >
        <div className="flex flex-col sm:flex-row items-center gap-2.5">
          <div className="relative w-full">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={licenseKeyInput}
              onChange={(e) => setLicenseKeyInput(e.target.value)}
              placeholder="e.g. NIMBUS-PRO-XXXX-XXXX or Polar key"
              className="pl-9 h-10 font-mono text-sm"
              onKeyDown={(e) => e.key === "Enter" && handleActivate()}
            />
          </div>
          <Button
            onClick={handleActivate}
            disabled={activating || !licenseKeyInput.trim()}
            className="w-full sm:w-auto shrink-0 h-10 px-5"
          >
            {activating ? "Activating…" : "Activate Key"}
          </Button>
        </div>

        {subscription?.licenseKey && (
          <div className="flex items-center gap-2 rounded-xl bg-muted/60 px-3.5 py-2.5 text-xs text-muted-foreground">
            <KeyRound className="size-3.5 text-primary shrink-0" />
            <span>Active key: <code className="font-mono font-medium text-foreground">{subscription.licenseKey}</code></span>
          </div>
        )}
      </Section>
    </div>
  );
}
