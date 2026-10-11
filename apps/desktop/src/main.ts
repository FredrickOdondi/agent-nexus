import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));
const devMode = process.argv.includes("--dev") || process.env.NIMBUS_DEV === "1";
const DEV_WEB = process.env.NIMBUS_WEB_URL ?? "http://127.0.0.1:47830";
const DEV_SERVER = process.env.NIMBUS_SERVER_URL ?? "http://127.0.0.1:47831";

let mainWindow: BrowserWindow | null = null;
let serverProc: ChildProcess | null = null;
let serverUrl = DEV_SERVER;

app.setPath("userData", path.join(app.getPath("appData"), "Nimbus"));

function serverEntry(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "server", "index.js");
  return path.resolve(here, "../../server/dist/index.js");
}

function webDist(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, "web");
  return path.resolve(here, "../../web/dist");
}

async function isNimbus(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

function waitForReady(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("The local Nimbus server did not start in time."));
    }, timeoutMs);
    let buffered = "";
    const onData = (chunk: Buffer) => {
      buffered += chunk.toString();
      const match = /NIMBUS_READY\s+(\d+)/.exec(buffered);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (buf: Buffer) => process.stderr.write(buf));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Nimbus server exited before it was ready (code ${code ?? "unknown"}).`));
    });
  });
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createServer();
    socket.once("error", () => resolve(false));
    socket.listen(port, "127.0.0.1", () => socket.close(() => resolve(true)));
  });
}

/** Helpers shipped beside the app. Dev builds compile or write these on demand. */
function screenHelperEnv(): Record<string, string> {
  if (!app.isPackaged) return {};
  const dir = path.join(process.resourcesPath, "screen");
  const helper = path.join(dir, "nimbus-input");
  const ps1 = path.join(dir, "nimbus-screen.ps1");
  return {
    ...(existsSync(helper) ? { NIMBUS_INPUT_BIN: helper } : {}),
    ...(existsSync(ps1) ? { NIMBUS_SCREEN_PS1: ps1 } : {}),
  };
}

function freePort(preferred: number, attempts = 20): Promise<number> {
  return new Promise((resolve, reject) => {
    if (attempts <= 0) { reject(new Error("No free port for the local server.")); return; }
    const socket = net.createServer();
    socket.once("error", () => resolve(freePort(preferred + 1, attempts - 1)));
    socket.listen(preferred, "127.0.0.1", () => {
      socket.close(() => resolve(preferred));
    });
  });
}

/** Start the bundled server, or attach to one that is already running. */
async function ensureServer(): Promise<{ url: string; owns: boolean }> {
  if (devMode && (await isNimbus(DEV_SERVER))) {
    serverUrl = DEV_SERVER;
    return { url: DEV_SERVER, owns: false };
  }

  const entry = serverEntry();
  if (!existsSync(entry)) {
    throw new Error(`Server bundle not found at ${entry}. Run \`pnpm --filter @nimbus/server build\` first.`);
  }
  const dist = webDist();
  const dataDir = path.join(app.getPath("userData"), "data");
  const port = app.isPackaged ? 47831 : await freePort(devMode ? 47832 : 47831);
  if (app.isPackaged && !(await portIsFree(port))) {
    throw new Error(`Port ${port} is already in use. Quit the other Nimbus window and open the app again. Sign-in stays on http://127.0.0.1:${port}.`);
  }
  const child = spawn(
    process.execPath,
    [entry, `--port=${port}`, `--data-dir=${dataDir}`, ...(existsSync(dist) ? [`--web-dist=${dist}`] : [])],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", NIMBUS_PLATFORM_NAME: "Nimbus Desktop", ...screenHelperEnv() },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  serverProc = child;
  const readyPort = await waitForReady(child, 20_000);
  serverUrl = `http://127.0.0.1:${readyPort}`;
  child.on("exit", (code) => {
    serverProc = null;
    if (code && code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox("Nimbus stopped", `The local server exited unexpectedly (code ${code}).`);
    }
  });
  return { url: serverUrl, owns: true };
}

async function uiUrl(server: string): Promise<string> {
  if (devMode) {
    try {
      const res = await fetch(DEV_WEB, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return DEV_WEB;
    } catch { /* vite isn't running; the server can serve the built client */ }
  }
  return server;
}

function createWindow(url: string) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    title: "Nimbus",
    backgroundColor: "#f4f3f1",
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (isHttpUrl(target)) {
      void openHttpUrl(target).catch((error) => console.error("[nimbus] could not open the browser", error));
    }
    return { action: "deny" };
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  void mainWindow.loadURL(url);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function launch(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => {
      child.unref();
      resolve();
    }, 4000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code ?? "unknown"}`));
    });
  });
}

/** Hand the link to the OS so the default browser comes forward. shell.openExternal can resolve without showing a window. */
async function openHttpUrl(raw: string): Promise<void> {
  const target = new URL(raw.trim()).toString();
  const viaShell = () => shell.openExternal(target);
  try {
    if (process.platform === "darwin") await launch("/usr/bin/open", [target]);
    else if (process.platform === "win32") await viaShell();
    else await launch("xdg-open", [target]);
  } catch (error) {
    try {
      if (process.platform === "win32") await launch("rundll32.exe", ["url.dll,FileProtocolHandler", target]);
      else await viaShell();
    } catch (fallback) {
      throw fallback instanceof Error ? fallback : error;
    }
  }
}

function registerIpc() {
  ipcMain.on("nimbus:meta", (event) => {
    event.returnValue = { version: app.getVersion(), serverUrl };
  });
  ipcMain.handle("nimbus:open-external", async (_e, url: unknown) => {
    if (!isHttpUrl(url)) return false;
    try {
      await openHttpUrl(url);
      mainWindow?.blur();
      return true;
    } catch (error) {
      console.error("[nimbus] could not open the browser", error);
      return false;
    }
  });
  ipcMain.handle("nimbus:pick-folder", async () => {
    const parent = BrowserWindow.getFocusedWindow() ?? mainWindow;
    const options: Electron.OpenDialogOptions = { properties: ["openDirectory", "createDirectory"], title: "Choose a workspace folder" };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.on("nimbus:win", (event, action: unknown) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (action === "minimize") win.minimize();
    else if (action === "maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === "close") win.close();
  });
  ipcMain.handle("nimbus:win-maximized", (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    registerIpc();
    try {
      const server = await ensureServer();
      createWindow(await uiUrl(server.url));
    } catch (err) {
      dialog.showErrorBox("Nimbus couldn't start", (err as Error).message);
      app.quit();
    }
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void uiUrl(serverUrl).then(createWindow);
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    if (serverProc && !serverProc.killed) serverProc.kill();
  });
}
