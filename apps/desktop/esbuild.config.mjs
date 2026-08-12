import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import * as esbuild from "esbuild"

const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const isWatchMode = process.argv.includes("--watch")

// NOTE: npm workspaces hoist dependencies to the monorepo root, so the wasm packages are not under
// this package's node_modules. Resolve them instead of joining a fixed node_modules path.
//
// Each emscripten wrapper dynamically imports its glue via new URL("./<name>.js", import.meta.url).
// Keep the glue out of the CJS bundle so that URL resolves against out/extension.js at runtime, and
// copy the glue + wasm binary next to the bundle so it self-locates.
function wasmAssetsPlugin(packageName, baseName) {
  const distDir = path.dirname(fileURLToPath(import.meta.resolve(packageName)))

  return {
    name: `${baseName}-wasm-assets`,
    setup(build) {
      build.onResolve({ filter: new RegExp(`${baseName}\\.js$`) }, () => ({
        path: `./${baseName}.js`,
        external: true
      }))

      build.onEnd(() => {
        const outDir = path.join(packageRoot, "out")
        fs.mkdirSync(outDir, { recursive: true })

        for (const asset of [`${baseName}.js`, `${baseName}.wasm`]) {
          fs.copyFileSync(path.join(distDir, asset), path.join(outDir, asset))
        }
      })
    }
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
    "@storyboard/story-ai": path.join(packageRoot, "../../packages/story-ai/src/index.ts"),
    "@storyboard/story-pipeline": path.join(packageRoot, "../../packages/story-pipeline/src/index.ts"),
    "@": path.join(packageRoot, "src")
  },
  // esbuild leaves import.meta.url as an empty object in a CJS bundle, which breaks the
  // new URL("./<name>.js", import.meta.url) loaders. Shim it to the output file's URL so the glue
  // resolves next to out/.
  banner: {
    js: "const import_meta_url = require('node:url').pathToFileURL(__filename).href;"
  },
  define: {
    "import.meta.url": "import_meta_url"
  },
  plugins: [
    wasmAssetsPlugin("@seedcoat/wasm", "seedcoat"),
    wasmAssetsPlugin("@seedkernel/wasm", "seedkernel")
  ]
}

if (isWatchMode) {
  const context = await esbuild.context(extensionConfig)
  await context.watch()
  console.log("Watching extension host files...")
} else {
  await esbuild.build(extensionConfig)
}
