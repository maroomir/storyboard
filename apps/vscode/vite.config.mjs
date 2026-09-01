import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

import { aliasesFromTsconfig } from "../../scripts/aliases.mjs"

const packageRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: "webview-ui",
  resolve: {
    // Contracts only — the engine barrel would drag node-only modules into the browser bundle,
    // which is why the webview tsconfig maps that one entry and not the package root.
    alias: aliasesFromTsconfig(path.join(packageRoot, "webview-ui", "tsconfig.json"))
  },
  plugins: [react()],
  css: {
    postcss: path.join(packageRoot, "webview-ui", "postcss.config.cjs")
  },
  build: {
    outDir: "../out/webview-ui",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js",
        assetFileNames: "assets/[name][extname]",
        chunkFileNames: "assets/[name].js"
      }
    }
  }
})
