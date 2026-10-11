import type { Platform } from "@nimbus/shared";

export interface NimbusBridge {
  platform: string;
  version: string;
  isElectron: true;
  openExternal(url: string): void;
  pickFolder(): Promise<string | null>;
  window: { minimize(): void; maximize(): void; close(): void; isMaximized(): Promise<boolean> };
  serverUrl: string;
}

declare global {
  interface Window {
    nimbus?: NimbusBridge;
  }
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

export function openExternal(url: string) {
  if (bridge) bridge.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

export const isStandalonePwa = typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);
