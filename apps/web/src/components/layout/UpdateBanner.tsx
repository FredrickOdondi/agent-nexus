import { useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { useAutoUpdater } from "@/lib/useAutoUpdater";
import { isElectron } from "@/lib/platform";
import { Button } from "@/components/ui/button";

export function UpdateBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { status, installUpdate, hasUpdateDownloaded, isDownloading } = useAutoUpdater();

  if (!isElectron || dismissed) return null;
  if (!hasUpdateDownloaded && !isDownloading) return null;

  return (
    <aside aria-label="Software update" className="fixed bottom-4 right-4 z-50 flex max-w-sm items-center gap-3 rounded-2xl border border-border/80 bg-background/95 p-3.5 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-3 duration-300">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        {hasUpdateDownloaded ? (
          <Sparkles className="size-5 text-emerald-500" />
        ) : (
          <Loader2 className="size-5 animate-spin text-primary" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-foreground">
          {hasUpdateDownloaded ? `Nimbus v${status?.version ?? ""} is ready!` : "Downloading update…"}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {hasUpdateDownloaded
            ? "Restart now to apply the latest version."
            : `${status?.percent ?? 0}% completed`}
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {hasUpdateDownloaded ? (
          <Button
            size="xs"
            onClick={() => void installUpdate()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs px-2.5 py-1"
          >
            Restart
          </Button>
        ) : null}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Dismiss update notification"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </aside>
  );
}
