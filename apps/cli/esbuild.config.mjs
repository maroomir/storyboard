import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

import { aliasesFromTsconfig } from '../../scripts/aliases.mjs';
import { writeRuntimeManifest } from '../../scripts/runtimeManifest.mjs';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

// Bundling (rather than tsc emit) lets every consumer of @storyboard/story-engine read the package
// SOURCE, so there is no build ordering between packages and no stale dist to drift out of sync.
//
// The output is ESM because Ink (the TUI) and yoga-layout use top-level await, which a CommonJS
// bundle cannot express. Dependencies that still `require()` Node builtins get a `require` from the
// banner, and Ink's optional React DevTools hook is replaced by a stub so the bundle never tries to
// resolve a package that is not shipped.
await esbuild.build({
  bundle: true,
  entryPoints: [path.join(packageRoot, 'src/index.ts')],
  format: 'esm',
  logLevel: 'info',
  outdir: path.join(packageRoot, 'dist'),
  entryNames: '[name]',
  outExtension: { '.js': '.mjs' },
  platform: 'node',
  sourcemap: true,
  target: 'node20',
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __storyboardCreateRequire } from 'node:module';",
      'const require = __storyboardCreateRequire(import.meta.url);',
    ].join('\n'),
  },
  alias: {
    ...aliasesFromTsconfig(path.join(packageRoot, 'tsconfig.json')),
    'react-devtools-core': path.join(packageRoot, 'scripts/stubs/react-devtools-core.js'),
  },
});

// The CLI bundle has no externals; the manifest still ships so both tarballs have the same shape.
writeRuntimeManifest(packageRoot, []);
