import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sqliteWasmFileName = 'node-sqlite3-wasm.wasm';

// node-sqlite3-wasm reads its .wasm synchronously from the directory of the script that loaded it.
// Once the package is inlined into a bundle that directory is the bundle's, so each app copies the
// binary next to its bundle.
export function copySqliteWasm(outDirectory) {
  const requireFromNodePackage = createRequire(path.join(repoRoot, 'packages/story-node/package.json'));
  const moduleEntry = requireFromNodePackage.resolve('node-sqlite3-wasm');
  const source = path.join(path.dirname(moduleEntry), sqliteWasmFileName);

  fs.mkdirSync(outDirectory, { recursive: true });
  fs.copyFileSync(source, path.join(outDirectory, sqliteWasmFileName));
}
