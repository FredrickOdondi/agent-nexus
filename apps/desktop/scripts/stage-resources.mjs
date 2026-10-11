import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { INPUT_SWIFT, SCREEN_PS1 } from "../../../packages/agent-core/dist/tools/screen.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const screenDir = path.join(root, "resources", "screen");
const buildDir = path.join(root, "build");
mkdirSync(screenDir, { recursive: true });
mkdirSync(buildDir, { recursive: true });

writeFileSync(path.join(screenDir, "nimbus-screen.ps1"), SCREEN_PS1);
writeFileSync(path.join(screenDir, "nimbus-input.swift"), INPUT_SWIFT);
writeFileSync(path.join(buildDir, "icon.png"), appIcon(1024));

if (process.platform === "darwin") {
  const swift = path.join(screenDir, "nimbus-input.swift");
  const out = path.join(screenDir, "nimbus-input");
  const arm = `${out}-arm64`;
  const intel = `${out}-x64`;
  const armOk = spawnSync("swiftc", ["-O", "-target", "arm64-apple-macosx13.0", "-o", arm, swift], { stdio: "inherit" }).status === 0;
  const intelOk = spawnSync("swiftc", ["-O", "-target", "x86_64-apple-macosx13.0", "-o", intel, swift], { stdio: "inherit" }).status === 0;
  if (armOk && intelOk) {
    const lipo = spawnSync("lipo", ["-create", "-output", out, arm, intel], { stdio: "inherit" });
    if (lipo.status !== 0) process.exit(lipo.status ?? 1);
  } else if (armOk) {
    spawnSync("mv", [arm, out], { stdio: "inherit" });
  } else if (intelOk) {
    spawnSync("mv", [intel, out], { stdio: "inherit" });
  } else {
    console.error("swiftc could not build the screen helper. Install Xcode command line tools.");
    process.exit(1);
  }
  chmodSync(out, 0o755);
  console.log(`screen helper ${out}`);
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
      const lift = 1 - y / size;
      let r = 67 + lift * 28;
      let g = 56 + lift * 24;
      let b = 202;
      if (inLetter(x / size, y / size)) {
        r = 244;
        g = 243;
        b = 241;
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

function inLetter(nx, ny) {
  const left = nx > 0.34 && nx < 0.44 && ny > 0.3 && ny < 0.7;
  const right = nx > 0.56 && nx < 0.66 && ny > 0.3 && ny < 0.7;
  const diag = Math.abs((nx - 0.39) - (ny - 0.3) * 0.55) < 0.045 && ny > 0.3 && ny < 0.7 && nx > 0.34 && nx < 0.66;
  return left || right || diag;
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
