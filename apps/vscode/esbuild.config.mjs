import path from "node:path"
import { fileURLToPath } from "node:url"

import * as esbuild from "esbuild"

const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const isWatchMode = process.argv.includes("--watch")

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  bundle: true,
  entryPoints: ["src/extension.ts"],
  external: ["vscode"],
  format: "cjs",
  logLevel: "info",
  minify: false,
  outfile: "out/extension.js",
  platform: "node",
  sourcemap: true,
  target: "node18",
  alias: {
    "@storyboard/story-engine": path.join(packageRoot, "../../packages/story-engine/src/index.ts"),
    "@storyboard/story-format": path.join(packageRoot, "../../packages/story-format/src/index.ts"),
    "@storyboard/story-ai": path.join(packageRoot, "../../packages/story-ai/src/index.ts"),
    "@storyboard/story-pipeline": path.join(packageRoot, "../../packages/story-pipeline/src/index.ts"),
    "@": path.join(packageRoot, "src")
  }
}

if (isWatchMode) {
  const context = await esbuild.context(extensionConfig)
  await context.watch()
  console.log("Watching extension host files...")
} else {
  await esbuild.build(extensionConfig)
}
