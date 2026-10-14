import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  Apple,
  ArrowRight,
  Bot,
  Check,
  Crown,
  Download,
  ExternalLink,
  Eye,
  Globe,
  HardDrive,
  Key,
  Layers,
  Moon,
  Monitor,
  Smartphone,
  Sparkles,
  Sun,
  Terminal,
  Zap,
} from "lucide-react";
import { NimbusMark } from "@/components/brand/NimbusMark";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const DOWNLOAD_LINKS = {
  macUniversal: "https://github.com/FredrickOdondi/agent-nexus/releases/latest/download/Nimbus-0.1.1-universal.dmg",
  macArm64: "https://github.com/FredrickOdondi/agent-nexus/releases/latest/download/Nimbus-0.1.1-universal.dmg",
  macIntel: "https://github.com/FredrickOdondi/agent-nexus/releases/latest/download/Nimbus-0.1.1-universal.dmg",
  windowsExe: "https://github.com/FredrickOdondi/agent-nexus/releases/latest/download/Nimbus.Setup.0.1.1.exe",
  windowsArm64: "https://github.com/FredrickOdondi/agent-nexus/releases/latest/download/Nimbus.Setup.0.1.1.exe",
  githubReleases: "https://github.com/FredrickOdondi/agent-nexus/releases",
};

export type PlatformType = "mac" | "windows" | "other";

export function detectUserPlatform(): PlatformType {
  if (typeof window === "undefined") return "mac";
  const ua = window.navigator.userAgent.toLowerCase();
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "windows";
  return "other";
}

export function LandingPage({ onLaunchApp }: { onLaunchApp: () => void }) {
  const [platform, setPlatform] = useState<PlatformType>("mac");
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [downloadedPlatform, setDownloadedPlatform] = useState<"mac" | "windows" | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark") ? "dark" : "light";
    }
    return "dark";
  });

  useEffect(() => {
    setPlatform(detectUserPlatform());
  }, []);

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    try {
      localStorage.setItem("nimbus.theme", next);
    } catch {
      // ignore
    }
  };

  const triggerDownload = (targetPlatform: "mac" | "windows", url: string) => {
    setDownloadedPlatform(targetPlatform);
    setDownloadModalOpen(true);
    // Create temporary link to trigger file download
    const a = document.createElement("a");
    a.href = url;
    a.download = targetPlatform === "mac" ? "Nimbus-universal.dmg" : "Nimbus-Setup.exe";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/20 selection:text-primary">
      {/* Background ambient lighting */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 size-[650px] rounded-full bg-gradient-to-br from-primary/15 via-primary/5 to-transparent blur-3xl opacity-70" />
        <div className="absolute top-1/3 -right-40 size-[500px] rounded-full bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent blur-3xl opacity-50" />
        <div className="absolute top-2/3 -left-40 size-[500px] rounded-full bg-gradient-to-br from-emerald-500/10 via-cyan-500/5 to-transparent blur-3xl opacity-40" />
      </div>

      {/* Navigation Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-xl transition-all">
        <div className="max-w-6xl mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <NimbusMark size={32} state="idle" />
            <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text">
              Nimbus
            </span>
            <span className="hidden sm:inline-flex items-center rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary uppercase tracking-wider">
              v0.1.1 Live
            </span>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-xs font-medium text-muted-foreground">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#models" className="transition-colors hover:text-foreground">BYOK Models</a>
            <a href="#downloads" className="transition-colors hover:text-foreground">Downloads</a>
            <a href="#pricing" className="transition-colors hover:text-foreground">Pricing</a>
            <a
              href="https://github.com/fredrick-odondi/agent-nexus"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 transition-colors hover:text-foreground"
            >
              GitHub <ExternalLink className="size-3" />
            </a>
          </nav>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex size-9 items-center justify-center rounded-xl border border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>

            <Button
              variant="outline"
              size="sm"
              onClick={onLaunchApp}
              className="text-xs h-9 px-3.5 border-border/70 hover:bg-muted font-medium"
            >
              Launch Web App
            </Button>

            <Button
              size="sm"
              onClick={() => {
                if (platform === "windows") {
                  triggerDownload("windows", DOWNLOAD_LINKS.windowsExe);
                } else {
                  triggerDownload("mac", DOWNLOAD_LINKS.macUniversal);
                }
              }}
              className="hidden sm:inline-flex text-xs h-9 px-4 gap-1.5 bg-primary text-primary-foreground font-semibold shadow-xs"
            >
              <Download className="size-3.5" />
              Download
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* Hero Section */}
        <section className="pt-16 pb-20 md:pt-24 md:pb-28 px-4 sm:px-6 max-w-5xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1 text-xs font-medium text-primary mb-6 shadow-xs"
          >
            <Sparkles className="size-3.5 text-primary" />
            <span>Next-Generation Local-First Agent Workspace</span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.05 }}
            className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-foreground leading-[1.1] max-w-4xl mx-auto"
          >
            Bring your own models. <br />
            <span className="bg-gradient-to-r from-primary via-indigo-500 to-amber-500 bg-clip-text text-transparent">
              Own your workspace.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="mt-6 text-base sm:text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed"
          >
            Nimbus connects directly to your models (Ollama, DeepSeek, OpenAI, xAI) with zero markup.
            Reads and edits code, runs terminal commands, views your screen, and pairs with your phone over zero-knowledge encrypted sync.
          </motion.p>

          {/* Primary CTA with OS Auto-Detection */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.15 }}
            className="mt-10 flex flex-col items-center gap-4"
          >
            <div className="flex flex-col sm:flex-row items-center gap-3">
              {platform === "windows" ? (
                <Button
                  size="lg"
                  onClick={() => triggerDownload("windows", DOWNLOAD_LINKS.windowsExe)}
                  className="h-13 px-8 text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 gap-2.5 rounded-xl group transition-all"
                >
                  <Monitor className="size-4.5" />
                  <span>Download for Windows</span>
                  <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-mono">.exe</span>
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              ) : (
                <Button
                  size="lg"
                  onClick={() => triggerDownload("mac", DOWNLOAD_LINKS.macUniversal)}
                  className="h-13 px-8 text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 gap-2.5 rounded-xl group transition-all"
                >
                  <Apple className="size-4.5" />
                  <span>Download for macOS</span>
                  <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-mono">.dmg</span>
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Button>
              )}

              <Button
                size="lg"
                variant="outline"
                onClick={onLaunchApp}
                className="h-13 px-7 text-sm font-medium border-border/80 hover:bg-muted/60 rounded-xl gap-2"
              >
                <span>Open in Web Browser</span>
                <Globe className="size-4 text-muted-foreground" />
              </Button>
            </div>

            {/* Architecture Subtitle & Links */}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>
                {platform === "windows"
                  ? "Windows 10 / 11 64-bit • Direct NSIS Installer"
                  : "macOS 12 Monterey+ • Apple Silicon (M1–M4) & Intel Universal"}
              </span>
              <span className="hidden sm:inline">•</span>
              <button
                type="button"
                onClick={() => {
                  const target = document.getElementById("downloads");
                  target?.scrollIntoView({ behavior: "smooth" });
                }}
                className="underline underline-offset-4 hover:text-foreground transition-colors font-medium"
              >
                View all downloads & architectures
              </button>
            </div>
          </motion.div>

          {/* Social Proof & Features Banner */}
          <div className="mt-14 pt-8 border-t border-border/40 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div className="space-y-1">
              <span className="block text-2xl font-bold tracking-tight text-foreground">0%</span>
              <span className="text-xs text-muted-foreground">Markup on Model Tokens</span>
            </div>
            <div className="space-y-1">
              <span className="block text-2xl font-bold tracking-tight text-foreground">Local SQLite</span>
              <span className="text-xs text-muted-foreground">Zero-Knowledge Storage</span>
            </div>
            <div className="space-y-1">
              <span className="block text-2xl font-bold tracking-tight text-foreground">Offline Ready</span>
              <span className="text-xs text-muted-foreground">Full Support for Ollama</span>
            </div>
            <div className="space-y-1">
              <span className="block text-2xl font-bold tracking-tight text-foreground">Universal</span>
              <span className="text-xs text-muted-foreground">macOS & Windows + Mobile</span>
            </div>
          </div>
        </section>

        {/* Workspace Mockup Showcase */}
        <section className="px-4 sm:px-6 max-w-5xl mx-auto pb-24">
          <div className="relative rounded-2xl border border-border/80 bg-card shadow-2xl overflow-hidden ring-1 ring-border/40">
            {/* Window titlebar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/40">
              <div className="flex items-center gap-2">
                <div className="size-3 rounded-full bg-rose-500/80" />
                <div className="size-3 rounded-full bg-amber-500/80" />
                <div className="size-3 rounded-full bg-emerald-500/80" />
                <span className="ml-2 font-mono text-xs text-muted-foreground">Nimbus Desktop — /Users/agent-nexus</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 text-[10px] font-semibold">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Ollama llama3.3:70b (Local)
                </span>
              </div>
            </div>

            {/* Mock interface body */}
            <div className="grid md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-border/60 text-xs font-mono">
              {/* Left sidebar mock */}
              <div className="md:col-span-3 p-4 bg-muted/20 space-y-4">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block mb-2">Custom Subagents</span>
                  <div className="flex items-center gap-2 rounded-lg bg-primary/10 text-primary px-2.5 py-1.5 font-sans font-medium text-xs">
                    <Bot className="size-3.5 text-primary" />
                    <span>/coder</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground font-sans hover:bg-muted/40">
                    <Bot className="size-3.5" />
                    <span>/researcher</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-muted-foreground font-sans hover:bg-muted/40">
                    <Bot className="size-3.5" />
                    <span>/reviewer</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-border/50">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block mb-2">Paired Devices</span>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-1.5"><Monitor className="size-3" /> MacBook Pro M3</span>
                    <span className="text-[10px] text-emerald-500 font-bold">Active</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground mt-1.5">
                    <span className="flex items-center gap-1.5"><Smartphone className="size-3" /> iPhone 16 Pro</span>
                    <span className="text-[10px] text-muted-foreground">Wi-Fi Sync</span>
                  </div>
                </div>
              </div>

              {/* Chat & tool stream mock */}
              <div className="md:col-span-9 p-5 font-sans space-y-4 bg-background/50">
                <div className="flex items-start gap-3">
                  <div className="size-7 rounded-lg bg-muted flex items-center justify-center font-mono text-xs font-semibold">U</div>
                  <div className="space-y-1">
                    <span className="text-xs font-semibold text-foreground">You</span>
                    <p className="text-sm text-foreground/90">
                      Parse the incoming Stripe webhook payloads, add type-safe validation, and verify our unit test coverage.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 pl-2">
                  <div className="size-7 rounded-lg bg-primary/15 text-primary flex items-center justify-center font-mono text-xs font-semibold shrink-0">
                    <NimbusMark size={18} />
                  </div>
                  <div className="space-y-2.5 w-full">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-primary">Nimbus Agent</span>
                      <span className="text-[10px] text-muted-foreground font-mono">Thought for 1.8s</span>
                    </div>

                    <div className="rounded-xl border border-border/80 bg-muted/40 p-3 space-y-2 font-mono text-xs">
                      <div className="flex items-center justify-between text-muted-foreground border-b border-border/40 pb-1.5">
                        <span className="flex items-center gap-1.5 font-semibold text-foreground">
                          <Terminal className="size-3.5 text-primary" /> run_command: pnpm --filter @nimbus/server test
                        </span>
                        <span className="text-emerald-500 font-bold">PASS (14 tests)</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground space-y-1">
                        <div>✓ packages/agent-core/src/tools/subagent.test.ts (2 passed)</div>
                        <div>✓ apps/server/src/paystack.test.ts (5 passed)</div>
                        <div>✓ apps/server/src/webhook.test.ts (7 passed)</div>
                      </div>
                    </div>

                    <p className="text-sm text-foreground/95">
                      I've added the webhook validation schemas and updated the parser. All 14 tests passed with zero regression.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Feature Highlights Grid */}
        <section id="features" className="py-20 border-t border-border/40 bg-muted/15 px-4 sm:px-6">
          <div className="max-w-6xl mx-auto">
            <div className="text-center max-w-2xl mx-auto mb-14">
              <h2 className="text-3xl font-bold tracking-tight text-foreground">
                Engineered for Developers Who Love Speed & Privacy
              </h2>
              <p className="mt-3 text-sm text-muted-foreground">
                Unlike cloud SaaS agents that hide their tokens and charge 10x markups, Nimbus is local-first, open-format, and brings the model directly to your codebase.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Card 1 */}
              <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs hover:border-primary/50 transition-colors space-y-3">
                <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Key className="size-5" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Bring Your Own Keys (BYOK)</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Use your own API keys for Ollama, DeepSeek, OpenAI, Anthropic, and xAI. You never pay a penny of token markup to us.
                </p>
              </div>

              {/* Card 2 */}
              <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs hover:border-primary/50 transition-colors space-y-3">
                <div className="size-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                  <HardDrive className="size-5" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Local SQLite Zero-Knowledge</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Your chat logs, memories, and workspace configurations reside locally on your machine. No telemetry or training on your code.
                </p>
              </div>

              {/* Card 3 */}
              <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs hover:border-primary/50 transition-colors space-y-3">
                <div className="size-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
                  <Smartphone className="size-5" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Desktop + Mobile Pairing</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Scan a QR code to pair your phone. Check in on background agents while walking away from your desk via Wi-Fi or encrypted relay.
                </p>
              </div>

              {/* Card 4 */}
              <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs hover:border-primary/50 transition-colors space-y-3">
                <div className="size-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                  <Layers className="size-5" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Custom Subagent Swarms</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Create dedicated subagents like <code>/architect</code>, <code>/qa</code>, and <code>/security</code> with distinct tool permissions and isolated contexts.
                </p>
              </div>

              {/* Card 5 */}
              <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs hover:border-primary/50 transition-colors space-y-3">
                <div className="size-10 rounded-xl bg-orange-500/10 text-orange-500 flex items-center justify-center">
                  <Eye className="size-5" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Screen & Computer Use</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Equipped with native screen inspection and mouse/keyboard automation to test browser webapps, fill forms, and verify layouts.
                </p>
              </div>

              {/* Card 6 */}
              <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs hover:border-primary/50 transition-colors space-y-3">
                <div className="size-10 rounded-xl bg-cyan-500/10 text-cyan-500 flex items-center justify-center">
                  <Zap className="size-5" />
                </div>
                <h3 className="text-base font-semibold text-foreground">Autonomous Background Watchers</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Nimbus monitors files, logs, and processes in the background and sends you instant notifications when builds fail or PRs require attention.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Model Support Section */}
        <section id="models" className="py-20 px-4 sm:px-6 max-w-5xl mx-auto">
          <div className="text-center max-w-xl mx-auto mb-12">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Compatible With Every Major LLM
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Plug in your provider of choice or run completely offline with local open-weights.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
            {[
              { name: "Ollama", tag: "100% Offline", desc: "Llama 3.3, Qwen 2.5, DeepSeek R1" },
              { name: "DeepSeek", tag: "API Direct", desc: "DeepSeek V3 & R1 Reasoning" },
              { name: "OpenAI", tag: "API Direct", desc: "GPT-4o, o1, o3-mini" },
              { name: "Anthropic", tag: "API Direct", desc: "Claude 3.7 Sonnet & Opus" },
              { name: "xAI Grok", tag: "API Direct", desc: "Grok 2 & Vision" },
            ].map((m) => (
              <div key={m.name} className="rounded-xl border border-border/70 bg-card/60 p-4 text-center space-y-2">
                <div className="font-semibold text-sm text-foreground">{m.name}</div>
                <span className="inline-block rounded-full bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5">
                  {m.tag}
                </span>
                <p className="text-[11px] text-muted-foreground">{m.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Download Matrix Section */}
        <section id="downloads" className="py-20 border-t border-border/40 bg-muted/20 px-4 sm:px-6">
          <div className="max-w-5xl mx-auto">
            <div className="text-center max-w-xl mx-auto mb-14">
              <h2 className="text-3xl font-bold tracking-tight text-foreground">
                Download Nimbus Desktop
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Available for macOS (Apple Silicon & Intel) and Windows (x64 & ARM64).
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {/* macOS Card */}
              <div className="relative rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col justify-between space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="size-10 rounded-xl bg-muted flex items-center justify-center text-foreground">
                        <Apple className="size-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-base">macOS</h3>
                        <span className="text-xs text-muted-foreground">Universal DMG Installer</span>
                      </div>
                    </div>
                    <span className="rounded-full bg-primary/10 text-primary text-[11px] font-bold px-2.5 py-0.5">
                      v0.1.1
                    </span>
                  </div>

                  <ul className="mt-6 space-y-2.5 text-xs text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-500 shrink-0" />
                      <span>Universal binary: Apple Silicon (M1/M2/M3/M4) + Intel</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-500 shrink-0" />
                      <span>Requires macOS 12 Monterey or higher</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-500 shrink-0" />
                      <span>Native screen and terminal permissions integration</span>
                    </li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <Button
                    onClick={() => triggerDownload("mac", DOWNLOAD_LINKS.macUniversal)}
                    className="w-full h-11 bg-primary text-primary-foreground font-semibold gap-2"
                  >
                    <Download className="size-4" />
                    Download for Mac (.dmg)
                  </Button>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                    <a href={DOWNLOAD_LINKS.macArm64} className="hover:underline">Apple Silicon only</a>
                    <a href={DOWNLOAD_LINKS.macIntel} className="hover:underline">Intel x64 only</a>
                  </div>
                </div>
              </div>

              {/* Windows Card */}
              <div className="relative rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col justify-between space-y-6">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="size-10 rounded-xl bg-muted flex items-center justify-center text-foreground">
                        <Monitor className="size-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-base">Windows</h3>
                        <span className="text-xs text-muted-foreground">NSIS Setup Installer</span>
                      </div>
                    </div>
                    <span className="rounded-full bg-primary/10 text-primary text-[11px] font-bold px-2.5 py-0.5">
                      v0.1.1
                    </span>
                  </div>

                  <ul className="mt-6 space-y-2.5 text-xs text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-500 shrink-0" />
                      <span>Standard 64-bit installer with automated updates</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-500 shrink-0" />
                      <span>Requires Windows 10 or Windows 11</span>
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 text-emerald-500 shrink-0" />
                      <span>PowerShell & WSL desktop integration support</span>
                    </li>
                  </ul>
                </div>

                <div className="space-y-2">
                  <Button
                    onClick={() => triggerDownload("windows", DOWNLOAD_LINKS.windowsExe)}
                    className="w-full h-11 bg-primary text-primary-foreground font-semibold gap-2"
                  >
                    <Download className="size-4" />
                    Download for Windows (.exe)
                  </Button>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                    <a href={DOWNLOAD_LINKS.windowsExe} className="hover:underline">x64 Installer</a>
                    <a href={DOWNLOAD_LINKS.windowsArm64} className="hover:underline">ARM64 Setup</a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing Summary Section */}
        <section id="pricing" className="py-20 px-4 sm:px-6 max-w-5xl mx-auto">
          <div className="text-center max-w-xl mx-auto mb-12">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Simple, Transparent Pricing
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Free to use forever with BYOK. Upgrade to Pro for unlimited multi-device sync and background autonomous watchers.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Free */}
            <div className="rounded-2xl border border-border bg-card p-6 flex flex-col justify-between space-y-6">
              <div>
                <h3 className="font-semibold text-lg">Free BYOK</h3>
                <p className="text-xs text-muted-foreground mt-1">For personal local-first agent workflows.</p>
                <div className="mt-4 text-3xl font-bold">$0</div>
                <ul className="mt-6 space-y-2.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2"><Check className="size-4 text-emerald-500" /> Bring your own models</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-emerald-500" /> Local SQLite privacy</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-emerald-500" /> Up to 2 paired devices</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-emerald-500" /> Up to 2 custom subagents</li>
                </ul>
              </div>
              <Button variant="outline" onClick={onLaunchApp} className="w-full text-xs h-9">
                Get Started Free
              </Button>
            </div>

            {/* Pro */}
            <div className="relative rounded-2xl border-2 border-primary bg-card p-6 flex flex-col justify-between space-y-6 shadow-md">
              <div className="absolute -top-3 right-6 rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-2.5 py-0.5 uppercase tracking-wider">
                Most Popular
              </div>
              <div>
                <h3 className="font-semibold text-lg flex items-center gap-1.5">
                  Pro <Sparkles className="size-4 text-amber-500" />
                </h3>
                <p className="text-xs text-muted-foreground mt-1">Uncapped multi-device power and speed.</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">$9</span>
                  <span className="text-xs text-muted-foreground">/ month or $89/yr</span>
                </div>
                <ul className="mt-6 space-y-2.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2 font-medium text-foreground"><Check className="size-4 text-primary" /> Everything in Free, plus:</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-primary" /> Unlimited paired devices</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-primary" /> Unlimited custom subagents</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-primary" /> Autonomous background watchers</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-primary" /> Encrypted cloud sync relay</li>
                </ul>
              </div>
              <Button onClick={onLaunchApp} className="w-full text-xs h-9 bg-primary text-primary-foreground font-semibold">
                Start 14-Day Free Trial
              </Button>
            </div>

            {/* Lifetime */}
            <div className="rounded-2xl border border-amber-500/40 bg-card p-6 flex flex-col justify-between space-y-6">
              <div>
                <h3 className="font-semibold text-lg flex items-center gap-1.5">
                  Lifetime Pass <Crown className="size-4 text-amber-500" />
                </h3>
                <p className="text-xs text-muted-foreground mt-1">Pay once, own Nimbus Pro forever.</p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-3xl font-bold">$129</span>
                  <span className="text-xs text-muted-foreground">/ one-time</span>
                </div>
                <ul className="mt-6 space-y-2.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2"><Check className="size-4 text-amber-500" /> All Pro features included</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-amber-500" /> Lifetime software updates</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-amber-500" /> Zero recurring subscription fees</li>
                  <li className="flex items-center gap-2"><Check className="size-4 text-amber-500" /> Founder badge & direct feedback</li>
                </ul>
              </div>
              <Button variant="outline" onClick={onLaunchApp} className="w-full text-xs h-9 border-amber-500/40 hover:bg-amber-500/10 hover:text-amber-600">
                Get Lifetime Pass
              </Button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40 py-12 px-4 sm:px-6 bg-muted/30">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2.5">
            <NimbusMark size={24} />
            <span className="font-semibold text-sm">Nimbus</span>
            <span className="text-xs text-muted-foreground">© 2026. Local-first AI agent workspace.</span>
          </div>

          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <a href="https://github.com/fredrick-odondi/agent-nexus" target="_blank" rel="noreferrer" className="hover:text-foreground">
              GitHub
            </a>
            <a href="#downloads" className="hover:text-foreground">
              Downloads
            </a>
            <a href="#features" className="hover:text-foreground">
              Features
            </a>
            <button type="button" onClick={onLaunchApp} className="hover:text-foreground font-medium text-primary">
              Launch Web App →
            </button>
          </div>
        </div>
      </footer>

      {/* Download Instructions Modal */}
      <Dialog open={downloadModalOpen} onOpenChange={setDownloadModalOpen}>
        <DialogContent className="max-w-md rounded-2xl bg-card border shadow-xl p-6">
          <DialogHeader>
            <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-2">
              <Download className="size-5" />
            </div>
            <DialogTitle className="text-lg font-bold">
              {downloadedPlatform === "mac" ? "Installing Nimbus on macOS" : "Installing Nimbus on Windows"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Your download should begin automatically. Follow the steps below to start using Nimbus.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {downloadedPlatform === "mac" ? (
              <ol className="space-y-3 list-decimal list-inside text-muted-foreground">
                <li className="leading-relaxed">
                  <strong className="text-foreground">Open the .dmg file:</strong> Locate <code>Nimbus-universal.dmg</code> in your Downloads folder and double-click it.
                </li>
                <li className="leading-relaxed">
                  <strong className="text-foreground">Drag to Applications:</strong> Drag the Nimbus icon into your Applications folder.
                </li>
                <li className="leading-relaxed">
                  <strong className="text-foreground">First-Time Launch:</strong> If macOS displays an <em>"unidentified developer"</em> notice, open <strong>System Settings → Privacy &amp; Security</strong>, scroll down to Security, and click <strong>"Open Anyway"</strong> (or right-click Nimbus in Applications and select <strong>Open</strong>).
                </li>
              </ol>
            ) : (
              <ol className="space-y-3 list-decimal list-inside text-muted-foreground">
                <li className="leading-relaxed">
                  <strong className="text-foreground">Run the installer:</strong> Double click <code>Nimbus-Setup.exe</code> from your Downloads folder.
                </li>
                <li className="leading-relaxed">
                  <strong className="text-foreground">Follow setup prompts:</strong> Nimbus will install and add a desktop shortcut.
                </li>
                <li className="leading-relaxed">
                  <strong className="text-foreground">Open Nimbus:</strong> Launch the app, enter your local or cloud model credentials, and start automating!
                </li>
              </ol>
            )}

            <div className="rounded-xl border border-border/80 bg-muted/40 p-3">
              <span className="block font-semibold text-foreground mb-1">Want to use Nimbus right now?</span>
              <p className="text-muted-foreground mb-2">You can also use the full Nimbus web workspace directly in your browser without waiting.</p>
              <Button size="sm" onClick={() => { setDownloadModalOpen(false); onLaunchApp(); }} className="w-full text-xs h-8">
                Launch Web App Immediately
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
