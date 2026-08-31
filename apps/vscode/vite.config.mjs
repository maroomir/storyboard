import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

const packageRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: "webview-ui",
  resolve: {
    alias: {
      "@webview": path.join(packageRoot, "webview-ui", "src")
    }
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
