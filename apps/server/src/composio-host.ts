import { connectComposioApp, listComposioApps, type OpenComposioInput } from "@nimbus/agent-core";
import { composioCatalogStates, type ComposioAppState, type ComposioKeySource, type SpaceSettings } from "@nimbus/shared";
import type { SpaceService } from "./space.js";

export interface ComposioStatus {
  configured: boolean;
  enabled: boolean;
  keySource: ComposioKeySource;
  apps: ComposioAppState[];
  error?: string;
}

function apiKeyOf(settings: SpaceSettings): { apiKey: string; source: Exclude<ComposioKeySource, "none"> } | null {
  if (settings.composioApiKey) return { apiKey: settings.composioApiKey, source: "settings" };
  if (process.env.COMPOSIO_API_KEY) return { apiKey: process.env.COMPOSIO_API_KEY, source: "env" };
  return null;
}

export function composioKeySource(settings: SpaceSettings): ComposioKeySource {
  return apiKeyOf(settings)?.source ?? "none";
}

/** Credentials for a run. Omitted when connected apps are off or no key is set. */
export function composioRuntime(settings: SpaceSettings, spaceId: string): OpenComposioInput | undefined {
  if (settings.composioEnabled === false) return undefined;
  const key = apiKeyOf(settings);
  if (!key) return undefined;
  return {
    apiKey: key.apiKey,
    userId: settings.composioUserId || `nimbus_${spaceId}`,
    sessionId: settings.composioSessionId,
  };
}

export function rememberComposioSession(space: SpaceService, sessionId: string) {
  const current = space.getSettings();
  const userId = current.composioUserId || `nimbus_${space.spaceId}`;
  if (current.composioSessionId === sessionId && current.composioUserId === userId) return;
  space.saveSettings({ ...current, composioUserId: userId, composioSessionId: sessionId });
}

function sessionInput(space: SpaceService): OpenComposioInput | null {
  const settings = space.getSettings();
  const runtime = composioRuntime({ ...settings, composioEnabled: true }, space.spaceId);
  if (!runtime) return null;
  return { ...runtime, onSessionId: (sessionId) => rememberComposioSession(space, sessionId) };
}

export async function composioStatus(space: SpaceService): Promise<ComposioStatus> {
  const settings = space.getSettings();
  const keySource = composioKeySource(settings);
  const enabled = settings.composioEnabled !== false;
  if (keySource === "none") return { configured: false, enabled, keySource, apps: composioCatalogStates() };
  if (!enabled) return { configured: true, enabled: false, keySource, apps: composioCatalogStates() };
  const input = sessionInput(space);
  if (!input) return { configured: false, enabled, keySource, apps: composioCatalogStates() };
  try {
    const apps = await listComposioApps(input);
    return { configured: true, enabled: true, keySource, apps };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach Composio";
    return { configured: true, enabled: true, keySource, apps: composioCatalogStates(), error: message.slice(0, 300) };
  }
}

export async function composioConnect(space: SpaceService, toolkit: string): Promise<{ redirectUrl: string | null }> {
  const settings = space.getSettings();
  if (composioKeySource(settings) === "none") throw new Error("Add a Composio API key in Settings → Apps.");
  if (settings.composioEnabled === false) throw new Error("Turn on connected apps before linking an account.");
  const input = sessionInput(space);
  if (!input) throw new Error("Add a Composio API key in Settings → Apps.");
  return connectComposioApp(input, toolkit);
}
