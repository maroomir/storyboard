import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

// Bundling (rather than tsc emit) lets every consumer of the shared packages read their SOURCE, so
// there is no build ordering between packages and no stale dist to drift out of sync.

// The @seedkernel/wasm wrapper dynamically imports its emscripten glue via
// new URL('./seedkernel.js', import.meta.url). Keep the glue out of the CJS bundle so that URL
// resolves against dist/ at runtime, and copy the glue + wasm binary next to the bundle.
const seedkernelDistDir = path.dirname(fileURLToPath(import.meta.resolve('@seedkernel/wasm')));

const seedkernelWasmPlugin = {
  name: 'seedkernel-wasm-assets',
  setup(build) {
    build.onResolve({ filter: /seedkernel\.js$/ }, () => ({
      path: './seedkernel.js',
      external: true,
    }));

    build.onEnd(() => {
      const outDir = path.join(packageRoot, 'dist');
      fs.mkdirSync(outDir, { recursive: true });

      for (const asset of ['seedkernel.js', 'seedkernel.wasm']) {
        fs.copyFileSync(path.join(seedkernelDistDir, asset), path.join(outDir, asset));
      }
    });
  },
};
await esbuild.build({
  bundle: true,
  entryPoints: [
    path.join(packageRoot, 'src/index.ts'),
    path.join(packageRoot, 'src/sync/syncWorker.ts'),
  ],
  // Native addon: it must stay a runtime require, not be inlined.
  external: ['better-sqlite3'],
  format: 'cjs',
  logLevel: 'info',
  outdir: path.join(packageRoot, 'dist'),
  entryNames: '[name]',
  platform: 'node',
  sourcemap: true,
  target: 'node20',
  // esbuild leaves import.meta.url as an empty object in a CJS bundle, which breaks the wasm
  // wrapper's new URL('./seedkernel.js', import.meta.url) loader.
  banner: {
    js: "#!/usr/bin/env node\nconst import_meta_url = require('node:url').pathToFileURL(__filename).href;",
  },
  define: { 'import.meta.url': 'import_meta_url' },
  plugins: [seedkernelWasmPlugin],
  alias: {
    '@storyboard/story-ai': path.join(packageRoot, '../../packages/story-ai/src/index.ts'),
    '@storyboard/story-pipeline': path.join(packageRoot, '../../packages/story-pipeline/src/index.ts'),
    '@storyboard/story-git': path.join(packageRoot, '../../packages/story-git/src/index.ts'),
  },
});
