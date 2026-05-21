import path from "node:path"
import { fileURLToPath } from "node:url"

import * as esbuild from "esbuild"

const repoRoot = path.dirname(fileURLToPath(import.meta.url))
const isWatchMode = process.argv.includes("--watch")

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  bundle: true,
  entryPoints: ["src/extension.ts"],
  external: ["vscode", "@seedcoat/wasm"],
  format: "cjs",
  logLevel: "info",
  minify: false,
  outfile: "out/extension.js",
  platform: "node",
  sourcemap: true,
  target: "node18",
  alias: {
    "@": path.join(repoRoot, "src")
  }
}

if (isWatchMode) {
  const context = await esbuild.context(extensionConfig)
  await context.watch()
  console.log("Watching extension host files...")
} else {
  await esbuild.build(extensionConfig)
}