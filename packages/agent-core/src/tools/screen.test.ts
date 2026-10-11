import assert from "node:assert/strict";
import test from "node:test";
import { INPUT_C, SCREEN_PS1 } from "./screen.js";
import {
  escapeSendKeysText,
  imageSize,
  jpegSize,
  macKeyScript,
  mapToScreen,
  pngSize,
  toMacKey,
  toSendKeys,
  toXdotoolKey,
} from "./screen-geom.js";

test("installer helpers contain the screen commands", () => {
  assert.match(SCREEN_PS1, /ValidateSet\("shot","click"/);
  assert.match(INPUT_C, /strcmp\(cmd, "click"\)/);
});

test("png size is read from the IHDR chunk", () => {
  const buf = Buffer.alloc(24);
  buf[0] = 0x89;
  buf.write("PNG", 1, "ascii");
  buf.writeUInt32BE(1920, 16);
  buf.writeUInt32BE(1080, 20);
  assert.deepEqual(pngSize(buf), { width: 1920, height: 1080 });
  assert.equal(pngSize(Buffer.from("nope")), null);
});

test("jpeg size is read from a SOF marker", () => {
  const buf = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x01, 0x00, // height 256
    0x02, 0x00, // width 512
    0x00,
  ]);
  assert.deepEqual(jpegSize(buf), { width: 512, height: 256 });
  assert.deepEqual(imageSize(buf), { width: 512, height: 256 });
});

test("screenshot pixels map onto the real screen, including a non-zero origin", () => {
  const frame = { imageWidth: 1280, imageHeight: 720, screenWidth: 2560, screenHeight: 1440, originX: 100, originY: 40 };
  assert.deepEqual(mapToScreen(0, 0, frame), { x: 100, y: 40 });
  assert.deepEqual(mapToScreen(640, 360, frame), { x: 1380, y: 760 });
  assert.deepEqual(mapToScreen(1280, 720, frame), { x: 2659, y: 1479 });
});

test("key chords stay inside each platform's vocabulary", () => {
  assert.equal(toXdotoolKey("ctrl+l"), "ctrl+l");
  assert.equal(toXdotoolKey("cmd+shift+t"), "super+shift+t");
  assert.equal(toXdotoolKey("enter"), "Return");
  assert.equal(toSendKeys("ctrl+l"), "^l");
  assert.equal(toSendKeys("enter"), "{ENTER}");
  assert.equal(escapeSendKeysText("a+b\n"), "a{+}b{ENTER}");
  const mac = toMacKey("cmd+c");
  assert.equal(macKeyScript(mac), 'tell application "System Events" to keystroke "c" using {command down}');
  assert.equal(macKeyScript(toMacKey("escape")), "tell application \"System Events\" to key code 53");
  assert.throws(() => toXdotoolKey("ctrl+not-a-key"));
});
