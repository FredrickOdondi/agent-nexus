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
    <div className="mx-4 mb-2 flex items-start gap-2 rounded-2xl bg-muted px-3 py-2.5 text-[13px] leading-snug text-muted-foreground">
      <p className="min-w-0 flex-1">
        {ios
          ? ipShortcut
            ? "This address opens inside Safari. Use the .local link from Settings → Devices, then Share → Add to Home Screen."
            : "Share → Add to Home Screen, then open Nimbus from the icon. That opens full screen."
          : "The Wi-Fi shortcut keeps Chrome’s bar. Hide it, or add the .local address from Settings → Devices."}
      </p>
      {!ios && (
        <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0" onClick={() => void hideBar()}>
          Hide bar
        </Button>
      )}
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
