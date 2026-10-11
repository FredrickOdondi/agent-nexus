import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "tsup";

/** esbuild does not know `node:sqlite` yet, so it rewrites the import to the npm name `sqlite`. */

/**
 * Bundles the server (and the workspace packages it depends on) into a single
 * ESM file so the Electron shell can fork it with no node_modules resolution.
 * Only `node:*` builtins stay external. Composio and the MCP SDK are bundled so a
 * packaged app does not need a node_modules tree beside the server.
 */
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  target: "node22",
  platform: "node",
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  noExternal: [/^@nimbus\//, /^@composio\//, /^@modelcontextprotocol\//, "hono", "@hono/node-server", "ws", "qrcode", "fast-glob", "ignore", "node-html-markdown"],
  banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  async onSuccess() {
    const file = "dist/index.js";
    const text = readFileSync(file, "utf8")
      .replaceAll('from "sqlite"', 'from "node:sqlite"')
      .replaceAll('__require("sqlite")', '__require("node:sqlite")');
    writeFileSync(file, text);
  },
});
