import path from "node:path"
import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

import { aliasesFromTsconfig } from "../../scripts/aliases.mjs"

// NOTE: Separate from vitest.config.ts so the generation harness never runs during
// `npm test`. Run explicitly: `npx vitest run --config vitest.harness.config.ts`.
const packageRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      vscode: path.join(packageRoot, "test/stubs/vscode.ts"),
      ...aliasesFromTsconfig(path.join(packageRoot, "tsconfig.json"))
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
