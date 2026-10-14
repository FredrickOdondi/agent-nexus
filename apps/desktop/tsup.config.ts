import { defineConfig } from "tsup";

export default defineConfig({
  entry: { main: "src/main.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  clean: false,
  splitting: false,
  sourcemap: true,
  external: ["electron", /^node:/],
  noExternal: ["electron-updater", /^builder-util-runtime/, /^fs-extra/, /^js-yaml/, /^sax/, /^typed-emitter/],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
