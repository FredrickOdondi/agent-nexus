import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INPUT_C, SCREEN_PS1 } from "../../../packages/agent-core/dist/tools/screen.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const screenDir = path.join(root, "resources", "screen");
const buildDir = path.join(root, "build");
mkdirSync(screenDir, { recursive: true });
mkdirSync(buildDir, { recursive: true });

writeFileSync(path.join(screenDir, "nimbus-screen.ps1"), SCREEN_PS1);
writeFileSync(path.join(screenDir, "nimbus-input.c"), INPUT_C);
writeFileSync(path.join(buildDir, "icon.png"), appIcon(1024));

const requested = process.argv.slice(2);
const host = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
const targets = requested.length ? requested : [host];

if (targets.includes("mac")) {
  const source = path.join(screenDir, "nimbus-input.c");
  const out = path.join(screenDir, "nimbus-input");
  const flags = ["-O2", "-framework", "CoreGraphics", "-framework", "CoreFoundation", "-o", out, source];
  const universal = spawnSync("clang", ["-arch", "arm64", "-arch", "x86_64", ...flags], { stdio: "inherit" });
  if (universal.status !== 0) {
    const native = spawnSync("clang", flags, { stdio: "inherit" });
    if (native.status !== 0) {
      console.error("clang could not build the screen helper. Install Xcode command line tools, then run pnpm desktop:dist again.");
      process.exit(native.status ?? 1);
    }
  }
  chmodSync(out, 0o755);
  console.log(`screen helper ${out}`);
}

if (process.argv.includes("web-icons")) {
  const webPublic = path.resolve(root, "../web/public");
  writeFileSync(path.join(webPublic, "icon-192.png"), appIcon(192));
  writeFileSync(path.join(webPublic, "icon-512.png"), appIcon(512));
  writeFileSync(path.join(webPublic, "apple-touch-icon.png"), appIcon(180));
  console.log("wrote web icons");
}

function appIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.46;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const i = row + 1 + x * 4;
      if (dx * dx + dy * dy > radius * radius) {
        raw[i] = raw[i + 1] = raw[i + 2] = raw[i + 3] = 0;
        continue;
      }
      const t = (x + y) / (size * 2);
      let r = 141 + (62 - 141) * t;
      let g = 124 + (207 - 124) * t;
      let b = 255 + (191 - 255) * t;
      const nx = x / size;
      const ny = y / size;
      if (inEye(nx, ny)) {
        r = 42;
        g = 33;
        b = 88;
      } else if (inCloud(nx, ny)) {
        r = 255;
        g = 255;
        b = 255;
      }
      raw[i] = r;
      raw[i + 1] = g;
      raw[i + 2] = b;
      raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function inBlob(nx, ny, cx, cy, rx, ry) {
  const dx = (nx - cx) / rx;
  const dy = (ny - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

function inCloud(nx, ny) {
  return inBlob(nx, ny, 0.38, 0.52, 0.14, 0.14)
    || inBlob(nx, ny, 0.54, 0.44, 0.16, 0.16)
    || inBlob(nx, ny, 0.68, 0.52, 0.12, 0.12)
    || inBlob(nx, ny, 0.52, 0.58, 0.22, 0.14);
}

function inEye(nx, ny) {
  return inBlob(nx, ny, 0.45, 0.54, 0.018, 0.024) || inBlob(nx, ny, 0.58, 0.53, 0.018, 0.024);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return ~c >>> 0;
}
