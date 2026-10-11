/** Pure geometry and key-chord helpers for the screen tool. No OS calls. */

export interface ScreenFrame {
  imageWidth: number;
  imageHeight: number;
  screenWidth: number;
  screenHeight: number;
  originX: number;
  originY: number;
}

export function clamp(n: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, n));
}

/** Map a point in the screenshot the model sees onto real screen pixels. */
export function mapToScreen(x: number, y: number, frame: ScreenFrame): { x: number; y: number } {
  const iw = frame.imageWidth || 1;
  const ih = frame.imageHeight || 1;
  const sx = frame.originX + (x / iw) * frame.screenWidth;
  const sy = frame.originY + (y / ih) * frame.screenHeight;
  return {
    x: clamp(Math.round(sx), frame.originX, frame.originX + Math.max(0, frame.screenWidth - 1)),
    y: clamp(Math.round(sy), frame.originY, frame.originY + Math.max(0, frame.screenHeight - 1)),
  };
}

export function pngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Read the size from a JPEG SOF marker. */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xd9) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

export function imageSize(buf: Buffer): { width: number; height: number } | null {
  return pngSize(buf) ?? jpegSize(buf);
}

export function splitChord(raw: string): { mods: string[]; key: string } {
  const parts = raw.trim().toLowerCase().split("+").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0 || parts.join("+").length > 40 || !/^[a-z0-9+_-]+$/.test(parts.join("+"))) {
    throw new Error(`Unsupported key "${raw.slice(0, 40)}". Use names like enter, tab, escape, or chords like ctrl+l and cmd+c.`);
  }
  const key = parts[parts.length - 1]!;
  return { mods: parts.slice(0, -1), key };
}

const X_MODS: Record<string, string> = {
  cmd: "super", command: "super", meta: "super", super: "super",
  ctrl: "ctrl", control: "ctrl",
  alt: "alt", opt: "alt", option: "alt",
  shift: "shift",
};

const X_KEYS: Record<string, string> = {
  enter: "Return", return: "Return", tab: "Tab", escape: "Escape", esc: "Escape",
  space: "space", backspace: "BackSpace", delete: "Delete",
  left: "Left", right: "Right", up: "Up", down: "Down",
  home: "Home", end: "End", pageup: "Page_Up", pagedown: "Page_Down",
};

/** xdotool key name, e.g. ctrl+l or Return. */
export function toXdotoolKey(raw: string): string {
  const { mods, key } = splitChord(raw);
  const mappedMods = mods.map((m) => {
    const name = X_MODS[m];
    if (!name) throw new Error(`Unknown modifier "${m}".`);
    return name;
  });
  const mapped = X_KEYS[key] ?? (/^[a-z0-9]$/.test(key) ? key : null);
  if (!mapped) throw new Error(`Unknown key "${key}".`);
  return [...mappedMods, mapped].join("+");
}

const WIN_MOD: Record<string, string> = {
  ctrl: "^", control: "^", alt: "%", opt: "%", option: "%", shift: "+",
  cmd: "^", command: "^", meta: "^", super: "^",
};

const WIN_KEY: Record<string, string> = {
  enter: "{ENTER}", return: "{ENTER}", tab: "{TAB}", escape: "{ESC}", esc: "{ESC}",
  space: " ", backspace: "{BACKSPACE}", delete: "{DELETE}",
  left: "{LEFT}", right: "{RIGHT}", up: "{UP}", down: "{DOWN}",
  home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}",
};

export function escapeSendKeysText(text: string): string {
  return text.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`).replace(/\r?\n/g, "{ENTER}");
}

/** Windows SendKeys chord. */
export function toSendKeys(raw: string): string {
  const { mods, key } = splitChord(raw);
  const prefix = mods.map((m) => {
    const s = WIN_MOD[m];
    if (!s) throw new Error(`Unknown modifier "${m}".`);
    return s;
  }).join("");
  const body = WIN_KEY[key] ?? (/^[a-z0-9]$/.test(key) ? escapeSendKeysText(key) : null);
  if (!body) throw new Error(`Unknown key "${key}".`);
  return prefix + body;
}

const MAC_MOD: Record<string, string> = {
  cmd: "command down", command: "command down", meta: "command down", super: "command down",
  ctrl: "control down", control: "control down",
  alt: "option down", opt: "option down", option: "option down",
  shift: "shift down",
};

const MAC_CODE: Record<string, number> = {
  enter: 36, return: 36, tab: 48, escape: 53, esc: 53, space: 49,
  backspace: 51, delete: 117,
  left: 123, right: 124, down: 125, up: 126,
  home: 115, end: 119, pageup: 116, pagedown: 121,
};

export type MacKey =
  | { kind: "code"; code: number; mods: string[] }
  | { kind: "char"; char: string; mods: string[] };

export function toMacKey(raw: string): MacKey {
  const { mods, key } = splitChord(raw);
  const using = mods.map((m) => {
    const s = MAC_MOD[m];
    if (!s) throw new Error(`Unknown modifier "${m}".`);
    return s;
  });
  const code = MAC_CODE[key];
  if (code !== undefined) return { kind: "code", code, mods: using };
  if (/^[a-z0-9]$/.test(key)) return { kind: "char", char: key, mods: using };
  throw new Error(`Unknown key "${key}".`);
}

/** AppleScript built only from a whitelisted key. */
export function macKeyScript(spec: MacKey): string {
  const using = spec.mods.length ? ` using {${spec.mods.join(", ")}}` : "";
  if (spec.kind === "code") return `tell application "System Events" to key code ${spec.code}${using}`;
  return `tell application "System Events" to keystroke "${spec.char}"${using}`;
}
