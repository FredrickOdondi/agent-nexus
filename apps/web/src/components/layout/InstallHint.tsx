import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectPlatform, isElectron, isStandalonePwa } from "@/lib/platform";

const KEY = "nimbus.installHint";

/**
 * Phones will not install an App Store app from a local http address.
 * This explains the only home-screen option the phone actually offers.
 */
export function InstallHint() {
  const [hidden, setHidden] = useState(() => localStorage.getItem(KEY) === "1");
  if (hidden || isElectron || isStandalonePwa || detectPlatform() !== "mobile") return null;

  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);

  return (
    <div className="flex items-start gap-2 border-b bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
      <p className="min-w-0 flex-1 leading-relaxed">
        {ios
          ? "Open this page in Safari, tap Share, then Add to Home Screen. The new icon opens full screen. It will not be listed in the App Store."
          : "Android can only save a shortcut from this Wi-Fi address, and that shortcut opens in Chrome. A separate installed app needs a public https site."}
      </p>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        aria-label="Dismiss"
        onClick={() => { localStorage.setItem(KEY, "1"); setHidden(true); }}
      >
        <X />
      </Button>
    </div>
  );
}
