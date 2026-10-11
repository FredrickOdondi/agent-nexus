import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  imageSize,
  macKeyScript,
  mapToScreen,
  pngSize,
  toMacKey,
  toSendKeys,
  toXdotoolKey,
  escapeSendKeysText,
  type ScreenFrame,
} from "./screen-geom.js";

export type { ScreenFrame };
export { mapToScreen };

const MAX_EDGE = 1280;
const AFTER_ACTION_MS = 280;

export class ScreenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenError";
  }
}

export interface Shot {
  bytes: Buffer;
  mime: "image/jpeg" | "image/png";
  imageWidth: number;
  imageHeight: number;
  screenWidth: number;
  screenHeight: number;
  originX: number;
  originY: number;
}

export interface ClickTarget {
  x: number;
  y: number;
  button: "left" | "right" | "middle";
  clicks: 1 | 2;
}

let lastFrame: ScreenFrame | null = null;

export function currentFrame(): ScreenFrame | null {
  return lastFrame;
}

export function rememberFrame(frame: ScreenFrame) {
  lastFrame = frame;
}

/** Map model coordinates through the last screenshot. Without one, they are treated as screen pixels. */
export function locate(x: number, y: number): { x: number; y: number; scaled: boolean } {
  if (!lastFrame) return { x: Math.round(x), y: Math.round(y), scaled: false };
  return { ...mapToScreen(x, y, lastFrame), scaled: true };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(bin: string, args: string[], timeoutMs = 20_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new ScreenError(`${bin} timed out.`));
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new ScreenError(`${bin} failed to start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new ScreenError((stderr || stdout || `${bin} exited ${code ?? "unknown"}`).trim().slice(0, 600)));
    });
  });
}

async function commandExists(name: string): Promise<boolean> {
  const entries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  for (const dir of entries) {
    for (const suffix of suffixes) {
      try {
        await fs.access(path.join(dir, name + suffix), constants.X_OK);
        return true;
      } catch { /* keep looking */ }
    }
  }
  return false;
}

async function firstAvailable(names: string[]): Promise<string | null> {
  for (const name of names) if (await commandExists(name)) return name;
  return null;
}

function frameFrom(shot: Pick<Shot, "imageWidth" | "imageHeight" | "screenWidth" | "screenHeight" | "originX" | "originY">): ScreenFrame {
  return {
    imageWidth: shot.imageWidth,
    imageHeight: shot.imageHeight,
    screenWidth: shot.screenWidth,
    screenHeight: shot.screenHeight,
    originX: shot.originX,
    originY: shot.originY,
  };
}

async function finishShot(file: string, screen: { width: number; height: number; originX: number; originY: number }, mime: Shot["mime"]): Promise<Shot> {
  const bytes = await fs.readFile(file);
  const size = imageSize(bytes);
  if (!size || size.width < 1 || size.height < 1) throw new ScreenError("The screenshot file could not be read.");
  const shot: Shot = {
    bytes,
    mime,
    imageWidth: size.width,
    imageHeight: size.height,
    screenWidth: screen.width,
    screenHeight: screen.height,
    originX: screen.originX,
    originY: screen.originY,
  };
  rememberFrame(frameFrom(shot));
  return shot;
}

export async function captureScreen(dataDir: string): Promise<Shot> {
  if (process.platform === "darwin") return shotMac();
  if (process.platform === "win32") return shotWindows(dataDir);
  return shotLinux();
}

async function shotMac(): Promise<Shot> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nimbus-screen-"));
  const png = path.join(dir, "screen.png");
  const jpg = path.join(dir, "screen.jpg");
  try {
    await run("screencapture", ["-x", "-D", "1", png]);
    const raw = await fs.readFile(png);
    const screen = pngSize(raw);
    if (!screen) throw new ScreenError("screencapture did not write a PNG.");
    if (screen.width > MAX_EDGE || screen.height > MAX_EDGE) await run("sips", ["-Z", String(MAX_EDGE), png]);
    await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "60", png, "--out", jpg]);
    return await finishShot(jpg, { width: screen.width, height: screen.height, originX: 0, originY: 0 }, "image/jpeg");
  } catch (e) {
    if (e instanceof ScreenError && /could not create image|not permitted|illegal/i.test(e.message)) {
      throw new ScreenError("Screen recording is blocked. On macOS, open System Settings → Privacy & Security → Screen Recording and allow the app that runs Nimbus.");
    }
    throw e;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function shotLinux(): Promise<Shot> {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new ScreenError("This process has no screen. Start Nimbus on the computer you want to click.");
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nimbus-screen-"));
  const png = path.join(dir, "screen.png");
  const jpg = path.join(dir, "screen.jpg");
  try {
    const tool = await firstAvailable(["grim", "gnome-screenshot", "scrot", "import"]);
    if (tool === "grim") await run("grim", [png]);
    else if (tool === "gnome-screenshot") await run("gnome-screenshot", ["-f", png]);
    else if (tool === "scrot") await run("scrot", ["-o", png]);
    else if (tool === "import") await run("import", ["-window", "root", png]);
    else if (process.env.DISPLAY && (await commandExists("ffmpeg"))) await grabX11(png);
    else {
      throw new ScreenError(process.env.WAYLAND_DISPLAY
        ? "No screenshot tool found. On Wayland, install grim."
        : "No screenshot tool found. Install scrot, ImageMagick, gnome-screenshot, or ffmpeg.");
    }
    const raw = await fs.readFile(png);
    const screen = pngSize(raw);
    if (!screen) throw new ScreenError("The screenshot tool did not write a PNG.");
    const resized = await shrinkLinux(png, jpg);
    return await finishShot(resized ? jpg : png, { width: screen.width, height: screen.height, originX: 0, originY: 0 }, resized ? "image/jpeg" : "image/png");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function grabX11(png: string): Promise<void> {
  let size = "1920x1080";
  if (await commandExists("xdotool")) {
    const { stdout } = await run("xdotool", ["getdisplaygeometry"]);
    const [w, h] = stdout.trim().split(/\s+/).map((n) => Number(n));
    if (w > 0 && h > 0) size = `${w}x${h}`;
  }
  const display = process.env.DISPLAY ?? ":0";
  await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "x11grab", "-video_size", size, "-i", display, "-frames:v", "1", png]);
}

async function shrinkLinux(png: string, jpg: string): Promise<boolean> {
  if (await commandExists("magick")) {
    await run("magick", [png, "-resize", `${MAX_EDGE}x${MAX_EDGE}>`, "-quality", "60", jpg]);
    return true;
  }
  if (await commandExists("convert")) {
    await run("convert", [png, "-resize", `${MAX_EDGE}x${MAX_EDGE}>`, "-quality", "60", jpg]);
    return true;
  }
  if (await commandExists("ffmpeg")) {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-vf", `scale='min(${MAX_EDGE},iw)':-2`, "-q:v", "5", jpg]);
    return true;
  }
  return false;
}

export const SCREEN_PS1 = String.raw`
param(
  [Parameter(Mandatory=$true)][ValidateSet("shot","click","move","drag","scroll","type","key")][string]$Verb,
  [int]$X = 0,
  [int]$Y = 0,
  [int]$ToX = 0,
  [int]$ToY = 0,
  [ValidateSet("left","right","middle")][string]$Button = "left",
  [int]$Clicks = 1,
  [int]$Wheel = 0,
  [string]$Text = "",
  [string]$OutFile = ""
)
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NimbusWin {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
"@
function Click-At([int]$x, [int]$y, [string]$button, [int]$times) {
  [NimbusWin]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 30
  for ($i = 0; $i -lt $times; $i++) {
    if ($button -eq "right") { [NimbusWin]::mouse_event(0x08, 0, 0, 0, 0); [NimbusWin]::mouse_event(0x10, 0, 0, 0, 0) }
    elseif ($button -eq "middle") { [NimbusWin]::mouse_event(0x20, 0, 0, 0, 0); [NimbusWin]::mouse_event(0x40, 0, 0, 0, 0) }
    else { [NimbusWin]::mouse_event(0x02, 0, 0, 0, 0); [NimbusWin]::mouse_event(0x04, 0, 0, 0, 0) }
    Start-Sleep -Milliseconds 40
  }
}
Add-Type -AssemblyName System.Windows.Forms
switch ($Verb) {
  "shot" {
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $edge = [Math]::Max($bmp.Width, $bmp.Height)
    if ($edge -gt 1280) {
      $scale = 1280 / $edge
      $nw = [Math]::Max(1, [int]($bmp.Width * $scale))
      $nh = [Math]::Max(1, [int]($bmp.Height * $scale))
      $small = New-Object System.Drawing.Bitmap $nw, $nh
      $sg = [System.Drawing.Graphics]::FromImage($small)
      $sg.DrawImage($bmp, 0, 0, $nw, $nh)
      $bmp.Dispose()
      $bmp = $small
    }
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]60)
    $bmp.Save($OutFile, $codec, $ep)
    Write-Output ("{0} {1} {2} {3}" -f $bounds.X, $bounds.Y, $bounds.Width, $bounds.Height)
  }
  "click" { Click-At $X $Y $Button $Clicks }
  "move" { [NimbusWin]::SetCursorPos($X, $Y) | Out-Null }
  "drag" {
    [NimbusWin]::SetCursorPos($X, $Y) | Out-Null
    Start-Sleep -Milliseconds 30
    if ($Button -eq "right") { [NimbusWin]::mouse_event(0x08, 0, 0, 0, 0) } else { [NimbusWin]::mouse_event(0x02, 0, 0, 0, 0) }
    [NimbusWin]::SetCursorPos($ToX, $ToY) | Out-Null
    Start-Sleep -Milliseconds 30
    if ($Button -eq "right") { [NimbusWin]::mouse_event(0x10, 0, 0, 0, 0) } else { [NimbusWin]::mouse_event(0x04, 0, 0, 0, 0) }
  }
  "scroll" {
    [NimbusWin]::SetCursorPos($X, $Y) | Out-Null
    [NimbusWin]::mouse_event(0x800, 0, 0, $Wheel, 0)
  }
  "type" {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait($Text)
  }
  "key" {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait($Text)
  }
}
`;

async function ps1Path(dataDir: string): Promise<string> {
  const bundled = process.env.NIMBUS_SCREEN_PS1;
  if (bundled) {
    try {
      await fs.access(bundled);
      return bundled;
    } catch { /* the packaged script is missing; write a copy */ }
  }
  const dir = path.join(dataDir, "bin");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "nimbus-screen.ps1");
  const hash = createHash("sha256").update(SCREEN_PS1).digest("hex").slice(0, 12);
  const stamp = path.join(dir, "nimbus-screen.ps1.sha");
  const prev = await fs.readFile(stamp, "utf8").catch(() => "");
  if (prev !== hash) {
    await fs.writeFile(file, SCREEN_PS1, "utf8");
    await fs.writeFile(stamp, hash, "utf8");
  }
  return file;
}

async function powershell(dataDir: string, args: string[]): Promise<string> {
  const file = await ps1Path(dataDir);
  const bin = (await commandExists("powershell")) ? "powershell" : "pwsh";
  const { stdout } = await run(bin, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, ...args], 30_000);
  return stdout.trim();
}

async function shotWindows(dataDir: string): Promise<Shot> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nimbus-screen-"));
  const jpg = path.join(dir, "screen.jpg");
  try {
    const line = await powershell(dataDir, ["-Verb", "shot", "-OutFile", jpg]);
    const [ox, oy, w, h] = line.split(/\s+/).map((n) => Number(n));
    if (![ox, oy, w, h].every((n) => Number.isFinite(n)) || !w || !h) throw new ScreenError("Windows did not report the screen size.");
    return await finishShot(jpg, { width: w, height: h, originX: ox, originY: oy }, "image/jpeg");
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export const INPUT_SWIFT = String.raw`
import Foundation
import CoreGraphics

func num(_ i: Int) -> CGFloat { CGFloat(Double(CommandLine.arguments[i]) ?? 0) }
func button(_ name: String) -> CGMouseButton {
  if name == "right" { return .right }
  if name == "middle" || name == "center" { return .center }
  return .left
}
func down(_ b: CGMouseButton) -> CGEventType {
  if b == .right { return .rightMouseDown }
  if b == .center { return .otherMouseDown }
  return .leftMouseDown
}
func up(_ b: CGMouseButton) -> CGEventType {
  if b == .right { return .rightMouseUp }
  if b == .center { return .otherMouseUp }
  return .leftMouseUp
}
func post(_ type: CGEventType, _ p: CGPoint, _ b: CGMouseButton) {
  CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: b)?.post(tap: .cghidEventTap)
}
let cmd = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : ""
switch cmd {
case "click":
  let p = CGPoint(x: num(2), y: num(3))
  let b = button(CommandLine.arguments[4])
  let n = max(1, min(Int(CommandLine.arguments[5]) ?? 1, 3))
  for _ in 0..<n {
    post(down(b), p, b)
    post(up(b), p, b)
    usleep(50_000)
  }
case "move":
  let p = CGPoint(x: num(2), y: num(3))
  CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
case "drag":
  let a = CGPoint(x: num(2), y: num(3))
  let b = CGPoint(x: num(4), y: num(5))
  let btn = button(CommandLine.arguments[6])
  post(down(btn), a, btn)
  usleep(30_000)
  post(.leftMouseDragged, b, btn)
  usleep(30_000)
  post(up(btn), b, btn)
case "scroll":
  let p = CGPoint(x: num(2), y: num(3))
  let lines = Int32(CommandLine.arguments[4]) ?? 0
  if let e = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: lines, wheel2: 0, wheel3: 0) {
    e.location = p
    e.post(tap: .cghidEventTap)
  }
default:
  fputs("unknown command\n", stderr)
  exit(2)
}
`;

let macHelper: string | null | undefined;

async function macInputBin(dataDir: string): Promise<string | null> {
  if (macHelper !== undefined) return macHelper;
  const bundled = process.env.NIMBUS_INPUT_BIN;
  if (bundled) {
    try {
      await fs.access(bundled, constants.X_OK);
      macHelper = bundled;
      return bundled;
    } catch { /* fall through to a local compile */ }
  }
  if (!(await commandExists("swiftc"))) {
    macHelper = null;
    return null;
  }
  const dir = path.join(dataDir, "bin");
  await fs.mkdir(dir, { recursive: true });
  const hash = createHash("sha256").update(INPUT_SWIFT).digest("hex").slice(0, 12);
  const bin = path.join(dir, `nimbus-input-${hash}`);
  try {
    await fs.access(bin, constants.X_OK);
    macHelper = bin;
    return bin;
  } catch { /* compile */ }
  const src = path.join(dir, `nimbus-input-${hash}.swift`);
  await fs.writeFile(src, INPUT_SWIFT, "utf8");
  try {
    await run("swiftc", ["-O", "-o", bin, src], 90_000);
    macHelper = bin;
    return bin;
  } catch {
    macHelper = null;
    return null;
  }
}

function macAccessibility(message: string): ScreenError {
  if (/not allowed|not permitted|1002|assistive|accessibility/i.test(message)) {
    return new ScreenError("Clicking is blocked. On macOS, open System Settings → Privacy & Security → Accessibility and allow the app that runs Nimbus (Electron or Terminal).");
  }
  return new ScreenError(message);
}

async function osascriptClick(x: number, y: number, clicks: number) {
  const script = `on run argv
    set x to (item 1 of argv) as integer
    set y to (item 2 of argv) as integer
    set n to (item 3 of argv) as integer
    tell application "System Events"
      repeat n times
        click at {x, y}
        delay 0.05
      end repeat
    end tell
  end run`;
  try {
    await run("osascript", ["-e", script, "--", String(x), String(y), String(clicks)]);
  } catch (e) {
    throw macAccessibility((e as Error).message);
  }
}

async function inputMac(dataDir: string, args: string[]) {
  const bin = await macInputBin(dataDir);
  if (bin) {
    try {
      await run(bin, args);
      return;
    } catch (e) {
      throw macAccessibility((e as Error).message);
    }
  }
  if (args[0] === "click" && (args[3] === "left" || args[3] === undefined)) {
    await osascriptClick(Number(args[1]), Number(args[2]), Number(args[4] ?? 1));
    return;
  }
  throw new ScreenError("This click needs the Nimbus input helper. Install the signed Mac app, or on a dev machine run xcode-select --install. Left click still works without it.");
}

async function inputLinux(args: { kind: "click" | "move" | "drag" | "scroll" | "type" | "key"; x?: number; y?: number; toX?: number; toY?: number; button?: "left" | "right" | "middle"; clicks?: number; wheel?: number; text?: string; key?: string }) {
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new ScreenError("This process has no screen. Start Nimbus on the computer you want to click.");
  }
  const wayland = Boolean(process.env.WAYLAND_DISPLAY) && !process.env.DISPLAY;
  if (wayland) {
    if (!(await commandExists("ydotool"))) throw new ScreenError("This is a Wayland session. Install ydotool so Nimbus can click, then try again.");
    await inputYdotool(args);
    return;
  }
  if (!(await commandExists("xdotool"))) throw new ScreenError("Install xdotool so Nimbus can click this screen, then try again.");
  const button = args.button === "right" ? "3" : args.button === "middle" ? "2" : "1";
  if (args.kind === "move" && args.x != null && args.y != null) {
    await run("xdotool", ["mousemove", String(args.x), String(args.y)]);
  } else if (args.kind === "click" && args.x != null && args.y != null) {
    await run("xdotool", ["mousemove", String(args.x), String(args.y), "click", "--repeat", String(args.clicks ?? 1), "--delay", "50", button]);
  } else if (args.kind === "drag" && args.x != null && args.y != null && args.toX != null && args.toY != null) {
    await run("xdotool", ["mousemove", String(args.x), String(args.y), "mousedown", button, "mousemove", String(args.toX), String(args.toY), "mouseup", button]);
  } else if (args.kind === "scroll" && args.x != null && args.y != null) {
    const wheel = args.wheel ?? 0;
    const count = Math.min(25, Math.abs(wheel));
    if (count > 0) {
      const btn = wheel > 0 ? "5" : "4";
      await run("xdotool", ["mousemove", String(args.x), String(args.y), "click", "--repeat", String(count), btn]);
    }
  } else if (args.kind === "type" && args.text != null) {
    await run("xdotool", ["type", "--delay", "12", "--", args.text]);
  } else if (args.kind === "key" && args.key != null) {
    await run("xdotool", ["key", "--", toXdotoolKey(args.key)]);
  }
}

async function inputYdotool(args: { kind: string; x?: number; y?: number; toX?: number; toY?: number; button?: string; clicks?: number; wheel?: number; text?: string; key?: string }) {
  const code = args.button === "right" ? "0xC1" : args.button === "middle" ? "0xC2" : "0xC0";
  if ((args.kind === "click" || args.kind === "move" || args.kind === "scroll") && args.x != null && args.y != null) {
    await run("ydotool", ["mousemove", "--absolute", "-x", String(args.x), "-y", String(args.y)]);
  }
  if (args.kind === "click") {
    const n = args.clicks ?? 1;
    for (let i = 0; i < n; i++) await run("ydotool", ["click", code]);
  } else if (args.kind === "drag" && args.x != null && args.y != null && args.toX != null && args.toY != null) {
    await run("ydotool", ["mousemove", "--absolute", "-x", String(args.x), "-y", String(args.y)]);
    await run("ydotool", ["mousedown", code]);
    await run("ydotool", ["mousemove", "--absolute", "-x", String(args.toX), "-y", String(args.toY)]);
    await run("ydotool", ["mouseup", code]);
  } else if (args.kind === "scroll") {
    const wheel = args.wheel ?? 0;
    const count = Math.min(25, Math.abs(wheel));
    const btn = wheel > 0 ? "0xC5" : "0xC4";
    for (let i = 0; i < count; i++) await run("ydotool", ["click", btn]);
  } else if (args.kind === "type" && args.text != null) {
    await run("ydotool", ["type", "--", args.text]);
  } else if (args.kind === "key" && args.key != null) {
    await run("ydotool", ["key", toXdotoolKey(args.key)]);
  }
}

export interface ScreenAction {
  dataDir: string;
  kind: "click" | "move" | "drag" | "scroll" | "type" | "key";
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  button?: "left" | "right" | "middle";
  clicks?: 1 | 2;
  /** Positive scrolls down. */
  wheel?: number;
  text?: string;
  key?: string;
}

export async function performAction(action: ScreenAction): Promise<void> {
  if (process.platform === "darwin") {
    if (action.kind === "click" || action.kind === "move") {
      await inputMac(action.dataDir, [action.kind, String(action.x), String(action.y), action.button ?? "left", String(action.clicks ?? 1)]);
    } else if (action.kind === "drag") {
      await inputMac(action.dataDir, ["drag", String(action.x), String(action.y), String(action.toX), String(action.toY), action.button ?? "left"]);
    } else if (action.kind === "scroll") {
      await inputMac(action.dataDir, ["scroll", String(action.x), String(action.y), String(-(action.wheel ?? 0))]);
    } else if (action.kind === "type") {
      try {
        await run("osascript", ["-e", "on run argv\n tell application \"System Events\" to keystroke (item 1 of argv)\nend run", "--", action.text ?? ""]);
      } catch (e) {
        throw macAccessibility((e as Error).message);
      }
    } else if (action.kind === "key") {
      try {
        await run("osascript", ["-e", macKeyScript(toMacKey(action.key ?? ""))]);
      } catch (e) {
        throw macAccessibility((e as Error).message);
      }
    }
    return;
  }
  if (process.platform === "win32") {
    if (action.kind === "click") {
      await powershell(action.dataDir, ["-Verb", "click", "-X", String(action.x), "-Y", String(action.y), "-Button", action.button ?? "left", "-Clicks", String(action.clicks ?? 1)]);
    } else if (action.kind === "move") {
      await powershell(action.dataDir, ["-Verb", "move", "-X", String(action.x), "-Y", String(action.y)]);
    } else if (action.kind === "drag") {
      await powershell(action.dataDir, ["-Verb", "drag", "-X", String(action.x), "-Y", String(action.y), "-ToX", String(action.toX), "-ToY", String(action.toY), "-Button", action.button ?? "left"]);
    } else if (action.kind === "scroll") {
      await powershell(action.dataDir, ["-Verb", "scroll", "-X", String(action.x), "-Y", String(action.y), "-Wheel", String(-(action.wheel ?? 0) * 120)]);
    } else if (action.kind === "type") {
      await powershell(action.dataDir, ["-Verb", "type", "-Text", escapeSendKeysText(action.text ?? "")]);
    } else if (action.kind === "key") {
      await powershell(action.dataDir, ["-Verb", "key", "-Text", toSendKeys(action.key ?? "")]);
    }
    return;
  }
  await inputLinux(action);
}

export async function settle() {
  await sleep(AFTER_ACTION_MS);
}

