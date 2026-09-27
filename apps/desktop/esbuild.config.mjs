import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

import { aliasesFromTsconfig } from '../../scripts/aliases.mjs';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const alias = aliasesFromTsconfig(path.join(packageRoot, 'tsconfig.json'));
const isWatch = process.argv.includes('--watch');

// Main and preload are bundled with every dependency inlined except Electron itself, so the packaged
// app ships no node_modules and electron-builder never resolves this monorepo's workspace links.
const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  external: ['electron'],
  alias,
};

const builds = [
  { ...shared, entryPoints: [path.join(packageRoot, 'src/main/index.ts')], outfile: path.join(packageRoot, 'dist/main/index.cjs') },
  // NOTE: 샌드박스 preload 는 `require('electron')` 말고는 아무 모듈도 부를 수 없다. 번들 하나로 낸다.
  { ...shared, entryPoints: [path.join(packageRoot, 'src/preload/index.ts')], outfile: path.join(packageRoot, 'dist/preload/index.cjs') },
];

if (isWatch) {
  for (const options of builds) {
    await (await esbuild.context(options)).watch();
  }
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
  writeAppManifest();
}

// electron-builder packages `dist/` as the app. Its manifest names only what the packaged app needs:
// no dependencies (all inlined), and a `main` relative to `dist/`.
function writeAppManifest() {
  const source = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  const manifest = {
    name: 'storyboard-desktop',
    productName: source.productName,
    version: source.version,
    description: source.description,
    author: source.author,
    license: source.license,
    main: 'main/index.cjs',
  };

  fs.writeFileSync(path.join(packageRoot, 'dist/package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}
