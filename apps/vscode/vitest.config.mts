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
      "@storyboard/story-engine/contracts": path.join(
        packageRoot,
        "../../packages/story-engine/src/shared/index.ts",
      ),
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
    environmentMatchGlobs: [["**/*.spec.tsx", "jsdom"]],
    include: ["test/unit/**/*.spec.ts", "test/unit/**/*.spec.tsx"]
  }
})
