import type { Platform } from "@nimbus/shared";

export type UpdateState = "checking" | "available" | "downloading" | "downloaded" | "not-available" | "error" | "dev";

export interface UpdateStatus {
  state: UpdateState;
  version?: string;
  percent?: number;
  bytesPerSecond?: number;
  message?: string;
}

export interface NimbusBridge {
  platform: string;
  version: string;
  isElectron: true;
  openExternal(url: string): Promise<boolean>;
  pickFolder(): Promise<string | null>;
  window: { minimize(): void; maximize(): void; close(): void; isMaximized(): Promise<boolean> };
  updater?: {
    checkForUpdates(): Promise<UpdateStatus>;
    installUpdate(): Promise<boolean>;
    onStatus(callback: (status: UpdateStatus) => void): () => void;
  };
  serverUrl: string;
}

declare global {
  interface Window {
    nimbus?: NimbusBridge;
  }
}

function desktopBridge(): NimbusBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return window.nimbus;
}

export const bridge = typeof window !== "undefined" ? window.nimbus : undefined;
export const isElectron = Boolean(bridge?.isElectron);
export const isMac = (bridge?.platform ?? "") === "darwin" || (!isElectron && /Mac/i.test(navigator.platform));

export function detectPlatform(): Platform {
  if (isElectron) return "desktop";
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Mac/i.test(ua))) return "mobile";
  return "web";
}

export function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (isElectron) return `${isMac ? "Mac" : bridge?.platform === "win32" ? "Windows" : "Linux"} desktop`;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Mac/.test(ua)) return "Mac browser";
  if (/Windows/.test(ua)) return "Windows browser";
  if (/Linux/.test(ua)) return "Linux browser";
  return "Browser";
}

export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Open a blank tab during the click, before any await, so the browser allows the later navigation. */
export function reserveExternalTab(): Window | null {
  if (desktopBridge()?.isElectron) return null;
  if (typeof window === "undefined") return null;
  return window.open("about:blank", "_blank");
}

export async function openExternal(url: string, reserved?: Window | null): Promise<boolean> {
  const target = safeHttpUrl(url);
  if (!target) {
    if (reserved && !reserved.closed) reserved.close();
    return false;
  }
  if (reserved && !reserved.closed) {
    try {
      reserved.location.replace(target);
      reserved.opener = null;
      return true;
    } catch {
      reserved.close();
    }
  }
  const host = desktopBridge();
  if (host?.openExternal) {
    try {
      return (await host.openExternal(target)) !== false;
    } catch {
      return false;
    }
  }
  const opened = window.open(target, "_blank", "noopener,noreferrer");
  return opened != null;
}

export const isStandalonePwa = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
