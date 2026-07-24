import path from "node:path"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const packageRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      vscode: path.join(packageRoot, "test/stubs/vscode.ts"),
      "@": path.join(packageRoot, "src"),
      "@webview": path.join(packageRoot, "webview-ui/src")
    }
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["**/*.spec.tsx", "jsdom"]],
    include: ["test/unit/**/*.spec.ts", "test/unit/**/*.spec.tsx"]
  }
})
