import type { ComposioAppState, ToolInfo } from "./types.js";

/** Meta tools the agent sees. Individual app actions stay behind search + execute. */
export const COMPOSIO_META_TOOLS: Omit<ToolInfo, "enabled">[] = [
  { id: "COMPOSIO_SEARCH_TOOLS", title: "search apps", category: "external", source: "composio", description: "Find the right action in an app the user has connected." },
  { id: "COMPOSIO_MANAGE_CONNECTIONS", title: "connect app", category: "external", source: "composio", description: "Connect an app or check whether it is already connected. Returns a link the user opens." },
  { id: "COMPOSIO_MULTI_EXECUTE_TOOL", title: "run app action", category: "external", source: "composio", description: "Run an action in a connected app." },
];

export const COMPOSIO_APP_CATALOG: { slug: string; name: string; blurb: string }[] = [
  { slug: "gmail", name: "Gmail", blurb: "Read and send mail" },
  { slug: "github", name: "GitHub", blurb: "Issues, pull requests, repos" },
  { slug: "slack", name: "Slack", blurb: "Channels and messages" },
  { slug: "notion", name: "Notion", blurb: "Pages and databases" },
  { slug: "linear", name: "Linear", blurb: "Issues and projects" },
  { slug: "googlecalendar", name: "Google Calendar", blurb: "Events and availability" },
  { slug: "googledrive", name: "Google Drive", blurb: "Files and folders" },
  { slug: "googlesheets", name: "Google Sheets", blurb: "Spreadsheets" },
  { slug: "discord", name: "Discord", blurb: "Servers and messages" },
  { slug: "outlook", name: "Outlook", blurb: "Mail and calendar" },
  { slug: "jira", name: "Jira", blurb: "Issues and boards" },
  { slug: "twitter", name: "X", blurb: "Posts and search" },
];

export function composioCatalogStates(): ComposioAppState[] {
  return COMPOSIO_APP_CATALOG.map((app) => ({ ...app, connected: false, noAuth: false }));
}
