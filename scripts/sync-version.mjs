import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// One version for the whole monorepo: the root manifest owns it and every app mirrors it, so a
// single `v*` tag releases the extension, the bot and the CLI as one set. Run this after editing
// the root version, then `npm install` to refresh the lockfile.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const version = rootManifest.version;

if (typeof version !== 'string' || version.length === 0) {
  console.error('The root package.json has no version.');
  process.exit(1);
}

const apps = ['apps/desktop', 'apps/bot', 'apps/cli'];
const checkOnly = process.argv.includes('--check');
let drifted = false;

for (const app of apps) {
  const manifestPath = path.join(repoRoot, app, 'package.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  if (manifest.version === version) {
    continue;
  }

  if (checkOnly) {
    console.error(`${app} is at ${manifest.version}, expected ${version}`);
    drifted = true;
    continue;
  }

  fs.writeFileSync(manifestPath, raw.replace(`"version": "${manifest.version}"`, `"version": "${version}"`));
  console.log(`${app}: ${manifest.version} -> ${version}`);
}

// The CLI hard-codes the version it prints, so it is part of the same invariant.
const cliEntry = path.join(repoRoot, 'apps/cli/src/index.ts');
const cliSource = fs.readFileSync(cliEntry, 'utf8');
const cliMatch = /const version = '([^']+)'/.exec(cliSource);

if (cliMatch && cliMatch[1] !== version) {
  if (checkOnly) {
    console.error(`apps/cli/src/index.ts prints ${cliMatch[1]}, expected ${version}`);
    drifted = true;
  } else {
    fs.writeFileSync(cliEntry, cliSource.replace(cliMatch[0], `const version = '${version}'`));
    console.log(`apps/cli/src/index.ts: ${cliMatch[1]} -> ${version}`);
  }
}

if (drifted) {
  process.exit(1);
}

console.log(checkOnly ? `All apps are at ${version}.` : `Synced every app to ${version}.`);
