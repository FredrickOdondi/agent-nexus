import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { detectPlatform, isElectron, isStandalonePwa } from "@/lib/platform";

const KEY = "nimbus.installHint";

/** Shown when the phone opened a browser shortcut instead of the full-screen icon. */
export function InstallHint() {
  const [hidden, setHidden] = useState(() => localStorage.getItem(KEY) === "1");
  const [fullscreen, setFullscreen] = useState(false);
  if (hidden || isElectron || isStandalonePwa || fullscreen || detectPlatform() !== "mobile") return null;

  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const ipShortcut = /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname);

  const hideBar = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setFullscreen(true);
    } catch {
      /* iOS Safari has no page fullscreen; the .local home screen icon is the path there. */
    }
  };

  return (
    <div className="flex items-start gap-2 border-b bg-muted/70 px-3 py-2 text-xs text-muted-foreground">
      <div className="min-w-0 flex-1 space-y-2 leading-relaxed">
        <p>
          {ios
            ? ipShortcut
              ? "This 192.168 shortcut opens inside Safari. Delete it. On your computer, Settings → Devices shows an address ending in .local. Open that in Safari, then Share → Add to Home Screen."
              : "Tap Share, then Add to Home Screen, and open Nimbus from the new icon. That icon has no Safari bar."
            : "Chrome keeps its address bar on a Wi-Fi shortcut. Hide it for this visit, or add the .local address from your computer’s Settings → Devices."}
        </p>
        {!ios && (
          <Button type="button" size="sm" variant="secondary" onClick={() => void hideBar()}>
            Hide browser bar
          </Button>
        )}
      </div>
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
