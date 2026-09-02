import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectSourceFiles,
  getImportPath,
  isWithin,
  parseSourceFile,
  requireAliasForEscapingImport,
  runArchitectureCheck,
} from '../../../scripts/architecture/runner.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');
const EXTENSION_ENTRY = path.join(SOURCE_ROOT, 'extension.ts');
const PRESENTATION_ROOT = path.join(SOURCE_ROOT, 'presentation');
const INFRASTRUCTURE_ROOT = path.join(SOURCE_ROOT, 'infrastructure');
const BOOTSTRAP_ROOT = path.join(SOURCE_ROOT, 'bootstrap');

const PACKAGES_ROOT = path.resolve(PACKAGE_ROOT, '..', '..', 'packages');
const SHARED_PACKAGES = [
  'story-engine',
  'story-format',
  'story-ai',
  'story-pipeline',
  'story-git',
  'story-config',
];
// Each package addresses its own files through a Node subpath import declared in its package.json.
// The prefix is private to the package: reaching for another one's would bind two packages through
// a path instead of through the entry point that is their actual contract.
const PACKAGE_INTERNAL_PREFIXES = {
  'story-engine': '#engine/',
  'story-format': '#format/',
  'story-ai': '#ai/',
  'story-pipeline': '#pipeline/',
  'story-git': '#git/',
  'story-config': '#config/',
};
const ENGINE_SHARED_ROOT = path.join(PACKAGES_ROOT, 'story-engine', 'src', 'shared');

// What is left in the extension after the engine took the inner layers: infrastructure adapts
// VSCode for the engine, presentation drives it, bootstrap wires them. An adapter that reaches into
// presentation would make the extension's own host layer depend on its UI.
function refuseInfrastructureReachingOutward(filePath, target, report) {
  if (!isWithin(filePath, INFRASTRUCTURE_ROOT)) {
    return;
  }

  if ([PRESENTATION_ROOT, BOOTSTRAP_ROOT].some((root) => isWithin(target, root))) {
    report('Infrastructure imports an outer layer', filePath, target);
  }
}

function refuseWideExtensionEntry(filePath, importPath, _statement, report) {
  if (filePath !== EXTENSION_ENTRY || importPath === 'vscode') {
    return;
  }

  if (!importPath.startsWith('./bootstrap/')) {
    report(`extension.ts imports outside bootstrap (${importPath})`, filePath);
  }
}

const summary = [];

function checkSharedPackages(report, failures) {
  for (const name of SHARED_PACKAGES) {
    const packageRoot = path.join(PACKAGES_ROOT, name, 'src');

    if (!fs.existsSync(packageRoot)) {
      failures.push(`${name} package missing at ${packageRoot}`);
      continue;
    }

    const files = collectSourceFiles(packageRoot);
    summary.push(`${files.length} ${name}`);

    for (const filePath of files) {
      const relative = path.relative(packageRoot, filePath).replaceAll(path.sep, '/');
      const text = fs.readFileSync(filePath, 'utf8');

      // An inline `import('vscode').Uri` is not an import statement, so the statement walk below
      // never sees it. It still makes the package need the editor's types.
      if (/\bimport\(\s*['"]vscode['"]\s*\)/.test(text)) {
        failures.push(`${name} references vscode types inline: ${relative}`);
      }

      for (const statement of parseSourceFile(filePath).statements) {
        const importPath = getImportPath(statement);

        if (!importPath) {
          continue;
        }

        if (importPath === 'vscode') {
          failures.push(`${name} imports vscode: ${relative}`);
        }

        if (importPath.startsWith('@/') || importPath.startsWith('@webview/')) {
          failures.push(`${name} imports an app module: ${relative} -> ${importPath}`);
        }

        if (importPath.startsWith('#') && !importPath.startsWith(PACKAGE_INTERNAL_PREFIXES[name])) {
          failures.push(
            `${name} reaches into another package's internals: ${relative} -> ${importPath}`,
          );
        }
      }
    }
  }
}

// Inside the engine, `shared` is the contract floor: it may import itself and nothing else, so a
// contract type can never drag domain logic into a webview or a CLI that only speaks the protocol.
function checkEngineSharedFloor(_report, failures) {
  for (const filePath of collectSourceFiles(ENGINE_SHARED_ROOT)) {
    for (const statement of parseSourceFile(filePath).statements) {
      const importPath = getImportPath(statement);

      if (!importPath?.startsWith('.')) {
        continue;
      }

      const target = path.resolve(path.dirname(filePath), importPath);

      if (!isWithin(target, ENGINE_SHARED_ROOT)) {
        failures.push(
          `story-engine shared imports outside itself: ${path.relative(ENGINE_SHARED_ROOT, filePath)}`,
        );
      }
    }
  }
}

runArchitectureCheck('Extension', SOURCE_ROOT, {
  rules: [refuseInfrastructureReachingOutward],
  importRules: [refuseWideExtensionEntry, requireAliasForEscapingImport(SOURCE_ROOT, '@/')],
  aliases: { '@/': '@/' },
  extraChecks: [checkSharedPackages, checkEngineSharedFloor],
  extraSummary: () => (summary.length > 0 ? `, ${summary.join(', ')}` : ''),
});
