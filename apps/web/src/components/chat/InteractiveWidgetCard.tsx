import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AppWindow,
  Check,
  Copy,
  ExternalLink,
  Maximize2,
  Minimize2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

interface InteractiveWidgetCardProps {
  title: string;
  html: string;
  description?: string;
  initialHeight?: number;
  className?: string;
}

export function InteractiveWidgetCard({
  title,
  html,
  description,
  initialHeight = 420,
  className,
}: InteractiveWidgetCardProps) {
  const sendMessage = useStore((s) => s.sendMessage);
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Generate enriched sandboxed HTML with system fonts, theme styles, and agent bridge
  const enrichedHtml = useMemo(() => {
    const isDark = document.documentElement.classList.contains("dark");
    const themeBg = isDark ? "#18181b" : "#ffffff";
    const themeFg = isDark ? "#f4f4f5" : "#09090b";
    const themeBorder = isDark ? "#27272a" : "#e4e4e7";
    const themeMuted = isDark ? "#71717a" : "#71717a";
    const themePrimary = isDark ? "#38bdf8" : "#0284c7";

    const baseBoilerplate = `
      <!DOCTYPE html>
      <html class="${isDark ? "dark" : ""}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          :root {
            --background: ${themeBg};
            --foreground: ${themeFg};
            --border: ${themeBorder};
            --muted: ${themeMuted};
            --primary: ${themePrimary};
            color-scheme: ${isDark ? "dark" : "light"};
          }
          *, *::before, *::after {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            padding: 1rem;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            background-color: var(--background);
            color: var(--foreground);
            -webkit-font-smoothing: antialiased;
          }
          button, input, select, textarea {
            font-family: inherit;
            font-size: inherit;
          }
          /* Custom scrollbar */
          ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }
          ::-webkit-scrollbar-track {
            background: transparent;
          }
          ::-webkit-scrollbar-thumb {
            background: var(--border);
            border-radius: 3px;
          }
        </style>
        <script>
          // Agent bi-directional bridge
          window.sendToAgent = function(text) {
            window.parent.postMessage({ type: "nimbus:prompt", text: String(text) }, "*");
          };
          window.nimbusAction = function(action, data) {
            window.parent.postMessage({ type: "nimbus:action", action: String(action), data }, "*");
          };
        </script>
      </head>
      <body>
        ${html}
      </body>
      </html>
    `;

    return baseBoilerplate;
  }, [html, refreshKey]);

  // Listen to postMessages from the sandboxed iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type === "nimbus:prompt" && typeof e.data.text === "string") {
        sendMessage(e.data.text).catch((err) => toast.error((err as Error).message));
      } else if (e.data.type === "nimbus:action") {
        toast.info(`Widget action: ${e.data.action}`, {
          description: e.data.data ? JSON.stringify(e.data.data) : undefined,
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [sendMessage]);

  const copyCode = () => {
    void navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
    toast.success("Widget HTML copied to clipboard");
  };

  const popOut = () => {
    const blob = new Blob([enrichedHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  return (
    <>
      <div
        className={cn(
          "my-3 overflow-hidden rounded-2xl border bg-surface elevation-2 transition-shadow",
          fullscreen ? "fixed inset-4 z-50 flex flex-col bg-background shadow-2xl" : "w-full",
          className
        )}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b bg-muted/30 px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <AppWindow className="size-3.5" />
            </span>
            <div className="min-w-0">
              <h4 className="truncate text-xs font-semibold tracking-tight text-foreground">
                {title}
              </h4>
              {description && (
                <p className="truncate text-[11px] text-muted-foreground">{description}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => setRefreshKey((k) => k + 1)} aria-label="Reset widget" />}>
                <RotateCcw className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>Reset widget state</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={copyCode} aria-label="Copy HTML" />}>
                {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
              </TooltipTrigger>
              <TooltipContent>Copy HTML</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={popOut} aria-label="Open in new window" />}>
                <ExternalLink className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>Open in standalone window</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-xs" onClick={() => setFullscreen((f) => !f)} aria-label={fullscreen ? "Minimize" : "Expand"} />}>
                {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
              </TooltipTrigger>
              <TooltipContent>{fullscreen ? "Exit fullscreen" : "Expand to fullscreen"}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Sandboxed iFrame */}
        <div
          className={cn(
            "relative w-full overflow-hidden bg-background",
            fullscreen ? "flex-1" : ""
          )}
          style={{ height: fullscreen ? "100%" : `${initialHeight}px` }}
        >
          <iframe
            key={refreshKey}
            ref={iframeRef}
            srcDoc={enrichedHtml}
            title={title}
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            className="size-full border-0"
          />
        </div>
      </div>

      {/* Backdrop when in fullscreen mode */}
      <AnimatePresence>
        {fullscreen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setFullscreen(false)}
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
          />
        )}
      </AnimatePresence>
    </>
  );
}
