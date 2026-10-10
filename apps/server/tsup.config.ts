import { defineConfig } from "tsup";

/**
 * Bundles the server (and the workspace packages it depends on) into a single
 * ESM file so the Electron shell can fork it with no node_modules resolution.
 * Only `node:*` builtins and the MCP SDK (optional, loaded lazily) stay external.
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
  noExternal: [/^@nimbus\//, "hono", "@hono/node-server", "ws", "qrcode", "fast-glob", "ignore", "node-html-markdown"],
  external: ["@modelcontextprotocol/sdk"],
  banner: { js: "#!/usr/bin/env node\nimport { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
