import { Check, Crown, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useStore } from "@/lib/store";

export function UpgradeModal() {
  const open = useStore((s) => s.upgradeModalOpen);
  const hint = useStore((s) => s.upgradeFeatureHint);
  const close = useStore((s) => s.closeUpgradeModal);
  const openSettings = useStore((s) => s.openSettings);
  const startTrial = useStore((s) => s.startTrial);
  const subscription = useStore((s) => s.subscription);

  const isTrialEligible = subscription?.isTrialEligible;

  const handleStartTrial = async () => {
    try {
      await startTrial();
      close();
    } catch {
      // toast shown in store
    }
  };

  const handleOpenBilling = () => {
    close();
    openSettings("subscription");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden rounded-2xl bg-background border shadow-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Upgrade to Nimbus Pro</DialogTitle>
          <DialogDescription>Unlock unlimited devices, subagents, and background monitors.</DialogDescription>
        </DialogHeader>

        {/* Hero header */}
        <div className="relative bg-gradient-to-br from-primary/15 via-primary/5 to-background p-6 border-b">
          <div className="flex items-center gap-2 mb-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Crown className="size-5" />
            </span>
            <span className="text-xs font-bold tracking-wider text-primary uppercase">
              Nimbus Pro
            </span>
          </div>

          <h2 className="text-xl font-bold tracking-tight text-foreground">
            {hint ? hint : "Supercharge your local-first agent workspace"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bring your own models with zero markup, plus unlimited multi-device pairing and autonomous capabilities.
          </p>
        </div>

        {/* Feature Highlights */}
        <div className="p-6 space-y-4">
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary mt-0.5">
                <Check className="size-3.5" />
              </span>
              <span><strong>Unlimited connected devices</strong> — pair your phone, laptop, and desktop seamlessly</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary mt-0.5">
                <Check className="size-3.5" />
              </span>
              <span><strong>Unlimited custom subagents</strong> & multi-agent system execution</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary mt-0.5">
                <Check className="size-3.5" />
              </span>
              <span><strong>Background watchers & notify</strong> — agents keep working while you're away</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary mt-0.5">
                <Check className="size-3.5" />
              </span>
              <span><strong>Encrypted cloud sync relay</strong> & automated backup</span>
            </li>
          </ul>

          <div className="pt-2 flex flex-col gap-2.5">
            {isTrialEligible && (
              <Button
                onClick={handleStartTrial}
                className="w-full h-11 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-semibold text-sm shadow-sm gap-2"
              >
                <Sparkles className="size-4" />
                Start 14-Day Free Pro Trial (No Credit Card)
              </Button>
            )}

            <Button
              variant={isTrialEligible ? "outline" : "default"}
              onClick={handleOpenBilling}
              className="w-full h-11 text-sm font-medium"
            >
              View Plans & Billing ($9/mo)
            </Button>
          </div>

          <p className="text-center text-[11px] text-muted-foreground">
            You bring your own model API keys. Cancel anytime with 1-click.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
