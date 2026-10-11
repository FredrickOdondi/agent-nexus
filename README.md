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

That builds the shared packages, starts the server on [http://127.0.0.1:47831](http://127.0.0.1:47831), and the web app on [http://127.0.0.1:47830](http://127.0.0.1:47830). Sign in with Google, then this computer links itself. A phone on the same Wi-Fi signs in with the same Google account and enters the pairing code. A different Google account gets its own chats.

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

## Installers

`pnpm desktop:dist` builds a Mac disk image or a Windows setup program for the computer you are on. The app includes the server and the web UI. It listens on `http://127.0.0.1:47831` and does not need Node installed.

Mac and Windows installers are produced on those systems (or in GitHub Actions: the Desktop installers workflow, run by hand or by pushing a `v*` tag). Download `Nimbus-*.dmg` or `Nimbus Setup *.exe` from the workflow artifacts.

The first public build should be signed. Add these repository secrets and the workflow will sign and, on Mac, notarize:

| Secret | Used for |
| --- | --- |
| `CSC_LINK` | Base64 Apple Developer ID `.p12` |
| `CSC_KEY_PASSWORD` | Password for that `.p12` |
| `APPLE_ID` | Apple ID that can notarize |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple team id |
| `WIN_CSC_LINK` | Base64 Windows Authenticode `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Password for that `.pfx` |

Without those secrets the workflow still uploads an installer. macOS Gatekeeper will ask the person to right-click the app and choose Open the first time, and Windows SmartScreen will warn. Screen Recording and Accessibility on a Mac stick to the app only after it is signed with a Developer ID.

On a Mac, the build compiles the click helper with `clang` and puts it inside the app. The first screenshot asks for Screen Recording. The first click asks for Accessibility.

On Linux in a container, add Electron's `--no-sandbox` flag if the process cannot set up its sandbox.

## Phone

`localhost` on your phone is the phone itself, so it can never open the app running on your computer. Vercel can host a static site, but this chat server keeps a live WebSocket, a SQLite file, and runs commands on your machine, so it has to stay on the computer.

Put the phone on the same Wi-Fi, run `pnpm dev`, then open **Settings → Devices** and generate a QR code. The code opens this computer’s Wi‑Fi address, such as `http://192.168.1.20:47830`, so the phone stays on that network. It does not use `localhost` or the `.local` name. A `.local` address is still listed for Add to Home Screen. macOS may ask to allow incoming connections for Node the first time.

## Sign in

Nimbus asks for Google through Supabase before it links a device. Each Google account has its own chats, settings, and devices on this computer. User A cannot open user B’s activity. Use the same Google account on the phone that you used on the computer that showed the pairing code. **Settings → Account** shows who is signed in. Signing out disconnects this browser; the chats stay on the computer for that account.

The Supabase project already has Google enabled. After Google, Supabase returns to the phone only when that phone’s address is in **Redirect URLs**. Otherwise it sends the browser to the Site URL. `http://127.0.0.1:47830` is the computer, so on the phone that address cannot connect. Open Authentication → URL configuration and allow:

- `http://127.0.0.1:47830/**`
- `http://127.0.0.1:47831/**`
- `http://localhost:47830/**`
- `http://localhost:47831/**`
- `http://*.local:47830/**`
- `http://192.168.*.*:47830/**`
- `http://10.*.*.*:47830/**`
- `http://172.*.*.*:47830/**`

The Site URL can stay `http://127.0.0.1:47830` for this computer. The phone uses the Wi‑Fi patterns above. Until that list matches, the phone can paste the `127.0.0.1` address into the sign-in page on the Wi‑Fi address and finish there.

The Google Cloud client’s redirect URI stays `https://<project-ref>.supabase.co/auth/v1/callback`.

## Link a phone

1. On the desktop, sign in with Google, then open **Settings → Devices** and choose **Generate**.
2. On the phone (same Wi-Fi), scan that QR code and sign in with the same Google account. The page that opens is the computer’s Wi‑Fi address. You can also type the 6-digit code if the phone is already on that address.
3. Chats, settings, and agent runs sync both ways. Each device has its own token; revoking a device in Settings disconnects it.

On a phone, Nimbus opens to the chat list. Tap a chat to open it full screen; Chats, or the system back button, returns to the list. Add the page to your home screen for an icon with no browser bar. The UI is the same code as the desktop — there is no separate mobile codebase.

## Models

With no API key, Nimbus runs in **offline demo mode**: the tool loop, persistence, and sync are real, and replies are scripted.

Open **Settings → Model** and paste a key. It stays in the local SQLite database and is never sent to linked devices.

| Provider | Base URL | Notes |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | Default. `deepseek-v4-pro` with thinking mode, or `deepseek-flash` for a faster model. Set `DEEPSEEK_API_KEY` or paste a key in Settings → Model |
| xAI Grok | `https://api.x.ai/v1` | Responses API, including hosted `web_search`, `x_search`, and `code_execution` when server tools are enabled |
| OpenAI-compatible | any `/v1` server | OpenAI, OpenRouter, Ollama, LM Studio, … |
| Offline demo | — | No network |

`BRAVE_API_KEY` makes the built-in `web_search` tool use the Brave API. Without it, the tool falls back to DuckDuckGo.

## Tools

The built-in set matches the Grok Build tool surface: `run_terminal_cmd`, `read_file`, `write_file`, `search_replace`, `list_dir`, `glob`, `grep`, `web_search`, `web_fetch`, `todo_write`, `task`, `get_task_output`, `ask_user_question`, `memory`, `enter_plan_mode`, `exit_plan_mode`, `skill`, `image_gen`, and `computer`. Permission modes (ask, auto, plan, read-only) and allow/deny rules live under **Settings → Agent & tools**.

## Screen

The `computer` tool lets the agent see this computer and click it. It screenshots the main display, then clicks, double-clicks, right-clicks, drags, scrolls, types, or presses keys. Each action returns a new screenshot. Coordinates are pixels of that image.

Clicks happen on the machine running the Nimbus server, including when the request comes from a linked phone. Ask mode prompts before every screen action. Allow or deny a single action with rules such as `Computer(screenshot)` and `Computer(*)`.

Aiming needs a model that can see images. Grok and GPT-4.1 can. A text-only model still receives the tool, but it cannot see where to click.

macOS asks for Screen Recording (to capture) and Accessibility (to click). Allow the app that launches Nimbus, Electron or Terminal. Linux on X11 needs `xdotool` and a screenshot tool (`scrot`, ImageMagick, `gnome-screenshot`, or `ffmpeg`). Wayland needs `grim` and `ydotool`.

## Connected apps

**Settings → Apps** uses [Composio](https://composio.dev). With a key saved, that screen lists the full toolkit directory (Gmail, GitHub, Slack, Notion, Figma, HubSpot, and the rest Composio offers), grouped and searchable. The agent searches for the right action, asks you to approve changes, and only runs it inside your Composio session.

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
| `DEEPSEEK_API_KEY` | unset | DeepSeek key. A key saved in Settings → Model replaces this |
| `BRAVE_API_KEY` | unset | Optional web search provider |
| `COMPOSIO_API_KEY` | unset | Lets the agent use apps you connect in Settings → Apps |

## Data

Everything for a space lives in one SQLite file. The web client caches conversations in IndexedDB so a reload paints instantly, then the WebSocket replays anything missed using a monotonic sequence number.
