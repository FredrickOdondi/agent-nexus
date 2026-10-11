import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const SERVER = process.env.NIMBUS_SERVER_URL ?? "http://127.0.0.1:47831";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: {
    host: "0.0.0.0",
    port: 47830,
    strictPort: true,
    proxy: {
      "/api": { target: SERVER, changeOrigin: true },
      "/ws": { target: SERVER.replace(/^http/, "ws"), ws: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "markdown", test: /node_modules[\\/](react-markdown|remark-.*|rehype-.*|lowlight|highlight\.js|micromark.*|mdast.*|hast.*|unified|unist.*|vfile.*)[\\/]/ },
            { name: "vendor", test: /node_modules[\\/](react|react-dom|scheduler|zustand|motion|framer-motion|@base-ui)[\\/]/ },
          ],
        },
      },
    },
  },
});
