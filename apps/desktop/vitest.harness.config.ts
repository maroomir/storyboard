import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

// NOTE: Separate from vitest.config.ts so the codex-backed generation harness never runs during
// `npm test`. Run explicitly: `npx vitest run --config vitest.harness.config.ts`.
const packageRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.join(packageRoot, "test/stubs/vscode.ts"),
      "@storyboard/story-engine": path.join(packageRoot, "../../packages/story-engine/src/index.ts"),
      "@storyboard/story-format": path.join(packageRoot, "../../packages/story-format/src/index.ts"),
      "@storyboard/story-ai": path.join(packageRoot, "../../packages/story-ai/src/index.ts"),
      "@storyboard/story-pipeline": path.join(packageRoot, "../../packages/story-pipeline/src/index.ts"),
      "@": path.join(packageRoot, "src"),
      "@webview": path.join(packageRoot, "webview-ui/src")
    }
  },
  test: {
    environment: "node",
    include: ["scripts/harness/**/*.harness.ts"],
    testTimeout: 7_200_000,
    hookTimeout: 7_200_000,
    fileParallelism: false
  }
})
