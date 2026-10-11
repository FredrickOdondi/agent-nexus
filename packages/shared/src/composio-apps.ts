import type { ComposioAppState, ToolInfo } from "./types.js";

/** Meta tools the agent sees. Individual app actions stay behind search + execute. */
export const COMPOSIO_META_TOOLS: Omit<ToolInfo, "enabled">[] = [
  { id: "COMPOSIO_SEARCH_TOOLS", title: "search apps", category: "external", source: "composio", description: "Find the right action in an app the user has connected." },
  { id: "COMPOSIO_MANAGE_CONNECTIONS", title: "connect app", category: "external", source: "composio", description: "Connect an app or check whether it is already connected. Returns a link the user opens." },
  { id: "COMPOSIO_MULTI_EXECUTE_TOOL", title: "run app action", category: "external", source: "composio", description: "Run an action in a connected app." },
];

/**
 * Preview shown before Composio answers. With a key, the Apps tab replaces this
 * with the full toolkit directory from the API.
 */
export const COMPOSIO_APP_CATALOG: { slug: string; name: string; blurb: string; category?: string }[] = [
  { slug: "gmail", name: "Gmail", blurb: "Read and send mail", category: "Email" },
  { slug: "outlook", name: "Outlook", blurb: "Mail and calendar", category: "Email" },
  { slug: "googlecalendar", name: "Google Calendar", blurb: "Events and availability", category: "Calendar" },
  { slug: "calendly", name: "Calendly", blurb: "Scheduling", category: "Calendar" },
  { slug: "googledrive", name: "Google Drive", blurb: "Files and folders", category: "Files" },
  { slug: "googledocs", name: "Google Docs", blurb: "Documents", category: "Files" },
  { slug: "googlesheets", name: "Google Sheets", blurb: "Spreadsheets", category: "Files" },
  { slug: "googleslides", name: "Google Slides", blurb: "Presentations", category: "Files" },
  { slug: "dropbox", name: "Dropbox", blurb: "Files", category: "Files" },
  { slug: "one_drive", name: "OneDrive", blurb: "Files", category: "Files" },
  { slug: "box", name: "Box", blurb: "Files", category: "Files" },
  { slug: "github", name: "GitHub", blurb: "Issues, pull requests, repos", category: "Developer" },
  { slug: "gitlab", name: "GitLab", blurb: "Repos and merge requests", category: "Developer" },
  { slug: "bitbucket", name: "Bitbucket", blurb: "Repos and pull requests", category: "Developer" },
  { slug: "sentry", name: "Sentry", blurb: "Errors", category: "Developer" },
  { slug: "linear", name: "Linear", blurb: "Issues and projects", category: "Work" },
  { slug: "jira", name: "Jira", blurb: "Issues and boards", category: "Work" },
  { slug: "asana", name: "Asana", blurb: "Tasks and projects", category: "Work" },
  { slug: "clickup", name: "ClickUp", blurb: "Tasks", category: "Work" },
  { slug: "trello", name: "Trello", blurb: "Boards", category: "Work" },
  { slug: "todoist", name: "Todoist", blurb: "Tasks", category: "Work" },
  { slug: "notion", name: "Notion", blurb: "Pages and databases", category: "Work" },
  { slug: "confluence", name: "Confluence", blurb: "Docs and spaces", category: "Work" },
  { slug: "airtable", name: "Airtable", blurb: "Bases", category: "Work" },
  { slug: "coda", name: "Coda", blurb: "Docs", category: "Work" },
  { slug: "slack", name: "Slack", blurb: "Channels and messages", category: "Chat" },
  { slug: "discord", name: "Discord", blurb: "Servers and messages", category: "Chat" },
  { slug: "microsoft_teams", name: "Microsoft Teams", blurb: "Chats and channels", category: "Chat" },
  { slug: "zoom", name: "Zoom", blurb: "Meetings", category: "Chat" },
  { slug: "telegram", name: "Telegram", blurb: "Messages", category: "Chat" },
  { slug: "whatsapp", name: "WhatsApp", blurb: "Messages", category: "Chat" },
  { slug: "hubspot", name: "HubSpot", blurb: "Contacts and deals", category: "Sales" },
  { slug: "salesforce", name: "Salesforce", blurb: "CRM", category: "Sales" },
  { slug: "pipedrive", name: "Pipedrive", blurb: "Deals", category: "Sales" },
  { slug: "intercom", name: "Intercom", blurb: "Customer conversations", category: "Support" },
  { slug: "zendesk", name: "Zendesk", blurb: "Tickets", category: "Support" },
  { slug: "freshdesk", name: "Freshdesk", blurb: "Tickets", category: "Support" },
  { slug: "stripe", name: "Stripe", blurb: "Payments", category: "Finance" },
  { slug: "shopify", name: "Shopify", blurb: "Store", category: "Finance" },
  { slug: "quickbooks", name: "QuickBooks", blurb: "Accounting", category: "Finance" },
  { slug: "figma", name: "Figma", blurb: "Design files", category: "Design" },
  { slug: "canva", name: "Canva", blurb: "Designs", category: "Design" },
  { slug: "miro", name: "Miro", blurb: "Boards", category: "Design" },
  { slug: "linkedin", name: "LinkedIn", blurb: "Posts and profiles", category: "Social" },
  { slug: "twitter", name: "X", blurb: "Posts and search", category: "Social" },
  { slug: "reddit", name: "Reddit", blurb: "Posts", category: "Social" },
  { slug: "youtube", name: "YouTube", blurb: "Videos", category: "Social" },
  { slug: "instagram", name: "Instagram", blurb: "Posts", category: "Social" },
  { slug: "facebook", name: "Facebook", blurb: "Pages and posts", category: "Social" },
  { slug: "mailchimp", name: "Mailchimp", blurb: "Campaigns", category: "Marketing" },
  { slug: "klaviyo", name: "Klaviyo", blurb: "Email and SMS", category: "Marketing" },
  { slug: "sendgrid", name: "SendGrid", blurb: "Email", category: "Marketing" },
  { slug: "typeform", name: "Typeform", blurb: "Forms", category: "Marketing" },
  { slug: "googleads", name: "Google Ads", blurb: "Campaigns", category: "Marketing" },
  { slug: "googleanalytics", name: "Google Analytics", blurb: "Traffic", category: "Marketing" },
  { slug: "supabase", name: "Supabase", blurb: "Database and auth", category: "Developer" },
  { slug: "snowflake", name: "Snowflake", blurb: "Warehouse", category: "Data" },
  { slug: "googlebigquery", name: "BigQuery", blurb: "Warehouse", category: "Data" },
];

export function composioCatalogStates(): ComposioAppState[] {
  return COMPOSIO_APP_CATALOG.map((app) => ({ ...app, connected: false, noAuth: false }));
}
