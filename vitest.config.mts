import path from "node:path"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const workspaceRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      vscode: path.join(workspaceRoot, "test/stubs/vscode.ts")
    }
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["**/*.spec.tsx", "jsdom"]],
    include: ["test/unit/**/*.spec.ts", "test/unit/**/*.spec.tsx"]
  }
})
