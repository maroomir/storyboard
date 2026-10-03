import path from "node:path"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

import { aliasesFromTsconfig } from "../../scripts/aliases.mjs"

const packageRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // The extension host is never loaded in tests; the stub stands in for the editor API.
      vscode: path.join(packageRoot, "test/stubs/vscode.ts"),
      ...aliasesFromTsconfig(path.join(packageRoot, "tsconfig.json"))
    }
  },
  test: {
    environment: "node",
    environmentMatchGlobs: [["**/*.spec.tsx", "jsdom"]],
    include: ["test/unit/**/*.spec.ts", "test/unit/**/*.spec.tsx"]
  }
})
