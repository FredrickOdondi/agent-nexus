import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";
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
import {
  commandExists,
  firstAvailable,
  run,
  ScreenError,
  sleep,
} from "./screen-proc.js";
import { see, seeBin } from "./screen-see.js";
import {
  buildPerception,
  getAxElements,
  runOcr,
  writeMarksFile,
  type PerceptionResult,
} from "./screen-perception.js";

export type { ScreenFrame };
export { mapToScreen, ScreenError };

const MAX_EDGE = 1920;
const AFTER_ACTION_MS = 280;

export interface Shot {
  bytes: Buffer;
  mime: "image/jpeg" | "image/png";
  imageWidth: number;
  imageHeight: number;
  screenWidth: number;
  screenHeight: number;
  originX: number;
  originY: number;
  perception?: PerceptionResult;
  isCrop?: boolean;
}

export interface CaptureOptions {
  withPerception?: boolean;
  crop?: { x: number; y: number; width: number; height: number };
}

export interface ClickTarget {
  x: number;
  y: number;
  button: "left" | "right" | "middle";
  clicks: 1 | 2;
}

let lastFrame: ScreenFrame | null = null;
let lastPerception: PerceptionResult | null = null;

export function currentFrame(): ScreenFrame | null {
  return lastFrame;
}

export function currentPerception(): PerceptionResult | null {
  return lastPerception;
}

export function rememberFrame(frame: ScreenFrame) {
  lastFrame = frame;
}

export function rememberPerception(p: PerceptionResult | null) {
  lastPerception = p;
}

/** Map model coordinates through the last screenshot. Without one, they are treated as screen pixels. */
export function locate(x: number, y: number): { x: number; y: number; scaled: boolean } {
  if (!lastFrame) return { x: Math.round(x), y: Math.round(y), scaled: false };
  return { ...mapToScreen(x, y, lastFrame), scaled: true };
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

async function finishShot(
  file: string,
  screen: { width: number; height: number; originX: number; originY: number },
  mime: Shot["mime"],
  perception?: PerceptionResult,
  isCrop?: boolean,
): Promise<Shot> {
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
    perception,
    isCrop,
  };
  if (!isCrop) {
    rememberFrame(frameFrom(shot));
    rememberPerception(perception ?? null);
  }
  return shot;
}

export async function captureScreen(dataDir: string, opts?: CaptureOptions): Promise<Shot> {
  if (process.platform === "darwin") return shotMac(dataDir, opts);
  if (process.platform === "win32") return shotWindows(dataDir, opts);
  return shotLinux(dataDir, opts);
}

async function getMacDisplayBounds(dataDir: string, fallbackWidth: number, fallbackHeight: number) {
  try {
    const out = await see(dataDir, ["bounds"]);
    const [ox, oy, w, h] = out.trim().split(/\s+/).map(Number);
    if (w && h) return { originX: ox || 0, originY: oy || 0, width: w, height: h };
  } catch {
    // fallback if see helper is unavailable
  }
  return { originX: 0, originY: 0, width: fallbackWidth, height: fallbackHeight };
}

async function shotMac(dataDir: string, opts?: CaptureOptions): Promise<Shot> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nimbus-screen-"));
  const png = path.join(dir, "screen.png");
  const jpg = path.join(dir, "screen.jpg");
  try {
    await run("screencapture", ["-x", "-D", "1", png]);
    const raw = await fs.readFile(png);
    const rawSize = pngSize(raw);
    if (!rawSize) throw new ScreenError("screencapture did not write a PNG.");

    // Accurate display bounds in points (not raw Retina pixels)
    const bounds = await getMacDisplayBounds(dataDir, rawSize.width, rawSize.height);

    // Compute target dimensions: logical points up to MAX_EDGE (1920)
    let targetW = bounds.width;
    let targetH = bounds.height;
    if (targetW > MAX_EDGE || targetH > MAX_EDGE) {
      const scale = MAX_EDGE / Math.max(targetW, targetH);
      targetW = Math.round(targetW * scale);
      targetH = Math.round(targetH * scale);
    }

    const frame: ScreenFrame = {
      imageWidth: targetW,
      imageHeight: targetH,
      screenWidth: bounds.width,
      screenHeight: bounds.height,
      originX: bounds.originX,
      originY: bounds.originY,
    };

    let perception: PerceptionResult | undefined;
    let marksFile: string | undefined;

    if (opts?.withPerception) {
      const [ax, ocr] = await Promise.all([
        getAxElements(dataDir).catch(() => null),
        runOcr(png, dataDir).catch(() => []),
      ]);
      perception = buildPerception(ax, ocr, frame);
      if (perception.elements.length > 0) {
        marksFile = await writeMarksFile(perception.elements);
      }
    }

    const canSee = (await seeBin(dataDir)) !== null;

    if (canSee) {
      if (opts?.crop) {
        // Map crop from image coordinates back to raw PNG pixels
        const scaleX = rawSize.width / (lastFrame?.imageWidth || targetW);
        const scaleY = rawSize.height / (lastFrame?.imageHeight || targetH);
        const cropX = Math.round(opts.crop.x * scaleX);
        const cropY = Math.round(opts.crop.y * scaleY);
        const cropW = Math.round(opts.crop.width * scaleX);
        const cropH = Math.round(opts.crop.height * scaleY);

        await see(dataDir, [
          "render",
          png,
          jpg,
          String(opts.crop.width),
          String(opts.crop.height),
          "0.90",
          String(cropX),
          String(cropY),
          String(cropW),
          String(cropH),
        ]);

        return await finishShot(jpg, bounds, "image/jpeg", perception, true);
      }

      await see(dataDir, [
        "render",
        png,
        jpg,
        String(targetW),
        String(targetH),
        "0.85",
        "0",
        "0",
        "0",
        "0",
        marksFile ?? "",
      ]);
      return await finishShot(jpg, bounds, "image/jpeg", perception, false);
    }

    // Fallback if see helper is not compiled
    if (rawSize.width > MAX_EDGE || rawSize.height > MAX_EDGE) {
      await run("sips", ["-Z", String(MAX_EDGE), png]);
    }
    await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80", png, "--out", jpg]);
    return await finishShot(jpg, bounds, "image/jpeg", perception, false);
  } catch (e) {
    if (e instanceof ScreenError && /could not create image|not permitted|illegal/i.test(e.message)) {
      throw new ScreenError("Screen recording is blocked. On macOS, open System Settings → Privacy & Security → Screen Recording and allow the app that runs Nimbus.");
    }
    throw e;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function shotLinux(dataDir: string, opts?: CaptureOptions): Promise<Shot> {
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

    let perception: PerceptionResult | undefined;
    if (opts?.withPerception) {
      const ocr = await runOcr(png, dataDir).catch(() => []);
      const frame: ScreenFrame = {
        imageWidth: screen.width,
        imageHeight: screen.height,
        screenWidth: screen.width,
        screenHeight: screen.height,
        originX: 0,
        originY: 0,
      };
      perception = buildPerception(null, ocr, frame);
    }

    const resized = await shrinkLinux(png, jpg);
    return await finishShot(resized ? jpg : png, { width: screen.width, height: screen.height, originX: 0, originY: 0 }, resized ? "image/jpeg" : "image/png", perception, false);
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
    await run("magick", [png, "-resize", `${MAX_EDGE}x${MAX_EDGE}>`, "-quality", "80", jpg]);
    return true;
  }
  if (await commandExists("convert")) {
    await run("convert", [png, "-resize", `${MAX_EDGE}x${MAX_EDGE}>`, "-quality", "80", jpg]);
    return true;
  }
  if (await commandExists("ffmpeg")) {
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", png, "-vf", `scale='min(${MAX_EDGE},iw)':-2`, "-q:v", "3", jpg]);
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
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[NimbusWin]::SetProcessDPIAware() | Out-Null
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
    if ($edge -gt 1920) {
      $scale = 1920 / $edge
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
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality, [long]80)
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

async function shotWindows(dataDir: string, opts?: CaptureOptions): Promise<Shot> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nimbus-screen-"));
  const jpg = path.join(dir, "screen.jpg");
  try {
    const line = await powershell(dataDir, ["-Verb", "shot", "-OutFile", jpg]);
    const [ox, oy, w, h] = line.split(/\s+/).map((n) => Number(n));
    if (![ox, oy, w, h].every((n) => Number.isFinite(n)) || !w || !h) throw new ScreenError("Windows did not report the screen size.");
    return await finishShot(jpg, { width: w, height: h, originX: ox, originY: oy }, "image/jpeg", undefined, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** C, not Swift: Command Line Tools often ship a Swift compiler that rejects the Mac SDK. */
export const INPUT_C = String.raw`
#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static double num(int i, int argc, char **argv) {
  return i < argc ? atof(argv[i]) : 0;
}

static CGMouseButton button_of(const char *name) {
  if (name && strcmp(name, "right") == 0) return kCGMouseButtonRight;
  if (name && (strcmp(name, "middle") == 0 || strcmp(name, "center") == 0)) return kCGMouseButtonCenter;
  return kCGMouseButtonLeft;
}

static CGEventType down_type(CGMouseButton b) {
  if (b == kCGMouseButtonRight) return kCGEventRightMouseDown;
  if (b == kCGMouseButtonCenter) return kCGEventOtherMouseDown;
  return kCGEventLeftMouseDown;
}

static CGEventType up_type(CGMouseButton b) {
  if (b == kCGMouseButtonRight) return kCGEventRightMouseUp;
  if (b == kCGMouseButtonCenter) return kCGEventOtherMouseUp;
  return kCGEventLeftMouseUp;
}

static void post(CGEventType type, CGPoint p, CGMouseButton b) {
  CGEventRef e = CGEventCreateMouseEvent(NULL, type, p, b);
  if (!e) return;
  CGEventPost(kCGHIDEventTap, e);
  CFRelease(e);
}

int main(int argc, char **argv) {
  const char *cmd = argc > 1 ? argv[1] : "";
  if (strcmp(cmd, "click") == 0) {
    CGPoint p = CGPointMake(num(2, argc, argv), num(3, argc, argv));
    CGMouseButton b = button_of(argc > 4 ? argv[4] : "left");
    int n = argc > 5 ? atoi(argv[5]) : 1;
    if (n < 1) n = 1;
    if (n > 3) n = 3;
    for (int i = 0; i < n; i++) {
      post(down_type(b), p, b);
      post(up_type(b), p, b);
      usleep(50000);
    }
    return 0;
  }
  if (strcmp(cmd, "move") == 0) {
    post(kCGEventMouseMoved, CGPointMake(num(2, argc, argv), num(3, argc, argv)), kCGMouseButtonLeft);
    return 0;
  }
  if (strcmp(cmd, "drag") == 0) {
    CGPoint a = CGPointMake(num(2, argc, argv), num(3, argc, argv));
    CGPoint b = CGPointMake(num(4, argc, argv), num(5, argc, argv));
    CGMouseButton btn = button_of(argc > 6 ? argv[6] : "left");
    CGEventType drag = btn == kCGMouseButtonRight ? kCGEventRightMouseDragged : kCGEventLeftMouseDragged;
    post(down_type(btn), a, btn);
    usleep(30000);
    post(drag, b, btn);
    usleep(30000);
    post(up_type(btn), b, btn);
    return 0;
  }
  if (strcmp(cmd, "scroll") == 0) {
    CGPoint p = CGPointMake(num(2, argc, argv), num(3, argc, argv));
    int lines = argc > 4 ? atoi(argv[4]) : 0;
    CGEventRef e = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 1, lines);
    if (e) {
      CGEventSetLocation(e, p);
      CGEventPost(kCGHIDEventTap, e);
      CFRelease(e);
    }
    return 0;
  }
  fputs("unknown command\n", stderr);
  return 2;
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
  if (!(await commandExists("clang"))) {
    macHelper = null;
    return null;
  }
  const dir = path.join(dataDir, "bin");
  await fs.mkdir(dir, { recursive: true });
  const hash = createHash("sha256").update(INPUT_C).digest("hex").slice(0, 12);
  const bin = path.join(dir, `nimbus-input-${hash}`);
  try {
    await fs.access(bin, constants.X_OK);
    macHelper = bin;
    return bin;
  } catch { /* compile */ }
  const src = path.join(dir, `nimbus-input-${hash}.c`);
  await fs.writeFile(src, INPUT_C, "utf8");
  try {
    await run("clang", ["-O2", "-framework", "CoreGraphics", "-framework", "CoreFoundation", "-o", bin, src], 60_000);
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
  throw new ScreenError("This click needs the Nimbus input helper. Install the Mac app, or on a dev machine install Xcode command line tools so clang is available. Left click still works without it.");
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
