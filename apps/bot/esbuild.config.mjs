import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

import { aliasesFromTsconfig } from '../../scripts/aliases.mjs';
import { writeRuntimeManifest } from '../../scripts/runtimeManifest.mjs';

import { bundleExternals } from './scripts/bundleExternals.mjs';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

// Bundling (rather than tsc emit) lets every consumer of @storyboard/story-format read the package
// SOURCE, so there is no build ordering between packages and no stale dist to drift out of sync.
await esbuild.build({
  bundle: true,
  entryPoints: [
    path.join(packageRoot, 'src/index.ts'),
    path.join(packageRoot, 'src/sync/syncWorker.ts'),
  ],
  external: bundleExternals,
  format: 'cjs',
  logLevel: 'info',
  outdir: path.join(packageRoot, 'dist'),
  entryNames: '[name]',
  platform: 'node',
  sourcemap: true,
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  alias: aliasesFromTsconfig(path.join(packageRoot, 'tsconfig.json')),
});

writeRuntimeManifest(packageRoot, bundleExternals);
