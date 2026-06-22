import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

// NOTE: Separate from vitest.config.ts so the codex-backed generation harness never runs during
// `npm test`. Run explicitly: `npx vitest run --config vitest.harness.config.ts`.
const workspaceRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.join(workspaceRoot, "test/stubs/vscode.ts"),
      "@": path.join(workspaceRoot, "src"),
      "@webview": path.join(workspaceRoot, "webview-ui/src")
    }
  },
  test: {
    environment: "node",
    include: ["scripts/harness/**/*.harness.ts"],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
    fileParallelism: false
  }
})
