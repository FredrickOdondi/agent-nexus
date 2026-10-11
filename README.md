# Nimbus

Nimbus is a local-first agent workspace. A thin desktop window, a phone browser on the same network, and one small Node process share a single chat — messages, tool runs, and settings sync live, the way WhatsApp keeps a phone and a desktop in step.

The agent runtime follows the same shape as Grok Build: a tool registry, permission rules, plan mode, subagents, skills (`SKILL.md`), memory (`MEMORY.md`), and hooks. There is no Next.js server. The UI is a static Vite app; the host is a single Hono process with SQLite.

## Layout

| Package | What it is |
| --- | --- |
| `packages/shared` | Types and the sync protocol shared by server and client |
| `packages/agent-core` | The agent loop, tools, providers, permissions, skills, memory |
| `apps/server` | Hono + WebSocket + SQLite. One file when bundled. Serves the UI in production |
| `apps/web` | Vite, React, Tailwind, shadcn/ui. Desktop layout and a phone layout from the same code |
| `apps/desktop` | Electron shell. Spawns the server and opens one window. No agent code of its own |

## Run it

Requires Node 22 and pnpm 10.

```bash
pnpm install
pnpm dev
```

That builds the shared packages, starts the server on [http://127.0.0.1:47831](http://127.0.0.1:47831), and the web app on [http://127.0.0.1:47830](http://127.0.0.1:47830). Opening the web app on the same machine signs you in automatically.

Desktop window (with `pnpm dev` already running):

```bash
pnpm dev:desktop
```

Standalone window, which starts its own server and serves the built UI from `~/.config/Nimbus`:

```bash
pnpm --filter @nimbus/server build
pnpm --filter @nimbus/web build
pnpm desktop
```

On Linux in a container, add Electron's `--no-sandbox` flag if the process cannot set up its sandbox.

## Phone

`localhost` on your phone is the phone itself, so it can never open the app running on your computer. Vercel can host a static site, but this chat server keeps a live WebSocket, a SQLite file, and runs commands on your machine, so it has to stay on the computer.

Put the phone on the same Wi-Fi, run `pnpm dev`, then open **Settings → Devices** and scan the QR code. Prefer the address ending in `.local` (for example `http://your-mac.local:47830`). A raw `192.168` address also works, but a home-screen icon saved from it opens inside the browser. macOS may ask to allow incoming connections for Node the first time.

## Link a phone

1. On the desktop, open **Settings → Devices** and choose **Generate**.
2. On the phone (same Wi-Fi), scan the QR code or open the LAN address and type the 6-digit code.
3. Chats, settings, and agent runs sync both ways. Each device has its own token; revoking a device in Settings disconnects it.

Add the page to your home screen for an app-style window. The UI is the same code as the desktop — there is no separate mobile codebase.

## Models

With no API key, Nimbus runs in **offline demo mode**: the tool loop, persistence, and sync are real, and replies are scripted.

Open **Settings → Model** and paste a key. It stays in the local SQLite database and is never sent to linked devices.

| Provider | Base URL | Notes |
| --- | --- | --- |
| xAI Grok | `https://api.x.ai/v1` | Responses API, including hosted `web_search`, `x_search`, and `code_execution` when server tools are enabled |
| OpenAI-compatible | any `/v1` server | OpenAI, OpenRouter, Ollama, LM Studio, … |
| Offline demo | — | No network |

`BRAVE_API_KEY` makes the built-in `web_search` tool use the Brave API. Without it, the tool falls back to DuckDuckGo.

## Tools

The built-in set matches the Grok Build tool surface: `run_terminal_cmd`, `read_file`, `write_file`, `search_replace`, `list_dir`, `glob`, `grep`, `web_search`, `web_fetch`, `todo_write`, `task`, `get_task_output`, `ask_user_question`, `memory`, `enter_plan_mode`, `exit_plan_mode`, `skill`, and `image_gen`. Permission modes (ask, auto, plan, read-only) and allow/deny rules live under **Settings → Agent & tools**.

## Connected apps

**Settings → Apps** uses [Composio](https://composio.dev) so the agent can work in Gmail, GitHub, Slack, Notion, and other accounts you connect. The agent searches for the right action, asks you to approve changes, and only runs it inside your Composio session.

Paste a Composio API key in that tab, or set `COMPOSIO_API_KEY` before `pnpm dev`. The key is stored in the local database (or read from the environment) and is never synced to a linked phone. Copy `.env.example` to `.env` if you want the environment variable loaded automatically. A key saved in Settings replaces the environment variable.

Drop `SKILL.md` packages in `<workspace>/.nimbus/skills/<name>/SKILL.md`. Durable notes go in `MEMORY.md`.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NIMBUS_PORT` | `47831` | Server port |
| `NIMBUS_HOST` | `0.0.0.0` | Bind address. Loopback-only bootstrap still requires a local client |
| `NIMBUS_DATA_DIR` | `~/.nimbus` | SQLite database, device tokens, memory |
| `NIMBUS_WORKSPACE` | `<data>/workspace` | Directory the agent reads, edits, and runs commands in |
| `NIMBUS_WEB_DIST` | unset | Built web client to serve. The desktop shell sets this |
| `BRAVE_API_KEY` | unset | Optional web search provider |
| `COMPOSIO_API_KEY` | unset | Lets the agent use apps you connect in Settings → Apps |

## Data

Everything for a space lives in one SQLite file. The web client caches conversations in IndexedDB so a reload paints instantly, then the WebSocket replays anything missed using a monotonic sequence number.
