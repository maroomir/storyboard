import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  root: "webview-ui",
  plugins: [react()],
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
