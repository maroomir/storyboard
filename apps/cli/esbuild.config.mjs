import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

import { aliasesFromTsconfig } from '../../scripts/aliases.mjs';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

// Bundling (rather than tsc emit) lets every consumer of @storyboard/story-engine read the package
// SOURCE, so there is no build ordering between packages and no stale dist to drift out of sync.
await esbuild.build({
  bundle: true,
  entryPoints: [path.join(packageRoot, 'src/index.ts')],
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
