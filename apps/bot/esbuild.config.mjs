import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

// Bundling (rather than tsc emit) lets every consumer of @storyboard/story-format read the package
// SOURCE, so there is no build ordering between packages and no stale dist to drift out of sync.
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
  banner: { js: '#!/usr/bin/env node' },
  alias: {
    '@storyboard/story-format': path.join(packageRoot, '../../packages/story-format/src/index.ts'),
    '@storyboard/story-ai': path.join(packageRoot, '../../packages/story-ai/src/index.ts'),
    '@storyboard/story-pipeline': path.join(packageRoot, '../../packages/story-pipeline/src/index.ts'),
    '@storyboard/story-git': path.join(packageRoot, '../../packages/story-git/src/index.ts'),
  },
});
