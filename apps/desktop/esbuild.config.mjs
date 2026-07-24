import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import * as esbuild from "esbuild"

const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const isWatchMode = process.argv.includes("--watch")

// NOTE: npm workspaces hoist dependencies to the monorepo root, so @seedcoat/wasm is not under
// this package's node_modules. Resolve it instead of joining a fixed node_modules path.
const seedcoatDistDir = path.dirname(fileURLToPath(import.meta.resolve("@seedcoat/wasm")))
const seedcoatWasmAssets = ["seedcoat.js", "seedcoat.wasm"]

// The @seedcoat/wasm loader dynamically imports its emscripten glue via
// new URL("./seedcoat.js", import.meta.url). Keep the glue out of the CJS
// bundle so that URL resolves against out/extension.js at runtime, and copy
// the glue + wasm binary next to the bundle so it self-locates.
const seedcoatWasmPlugin = {
  name: "seedcoat-wasm-assets",
  setup(build) {
    build.onResolve({ filter: /seedcoat\.js$/ }, () => ({
      path: "./seedcoat.js",
      external: true
    }))

    build.onEnd(() => {
      const outDir = path.join(packageRoot, "out")
      fs.mkdirSync(outDir, { recursive: true })

      for (const asset of seedcoatWasmAssets) {
        fs.copyFileSync(path.join(seedcoatDistDir, asset), path.join(outDir, asset))
      }
    })
  }
}

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
    "@storyboard/story-format": path.join(packageRoot, "../../packages/story-format/src/index.ts"),
    "@storyboard/story-ai": path.join(packageRoot, "../../packages/story-ai/src/index.ts"),
    "@": path.join(packageRoot, "src")
  },
  // esbuild leaves import.meta.url as an empty object in a CJS bundle, which
  // breaks @seedcoat/wasm's new URL("./seedcoat.js", import.meta.url) loader.
  // Shim it to the output file's URL so the glue resolves next to out/.
  banner: {
    js: "const import_meta_url = require('node:url').pathToFileURL(__filename).href;"
  },
  define: {
    "import.meta.url": "import_meta_url"
  },
  plugins: [seedcoatWasmPlugin]
}

if (isWatchMode) {
  const context = await esbuild.context(extensionConfig)
  await context.watch()
  console.log("Watching extension host files...")
} else {
  await esbuild.build(extensionConfig)
}
