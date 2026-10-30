import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  collectSourceFiles,
  getImportPath,
  parseSourceFile,
  requireAliasForSourceImport,
} from './runner.mjs';

// The rules here belong to the repository, not to one app: a package that imports `vscode` breaks
// the CLI and the desktop just as much as the extension, and an owned literal may be repeated from
// any workspace. Each app's own `scripts/check-architecture.mjs` keeps only its own layer rules.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGES_ROOT = path.join(REPO_ROOT, 'packages');
const SHARED_PACKAGES = [
  'story-engine',
  'story-app',
  'story-model',
  'story-ai',
  'story-config',
  'story-node',
  'story-sim',
];
// Each package addresses its own files through a Node subpath import declared in its package.json.
// The prefix is private to the package: reaching for another one's would bind two packages through
// a path instead of through the entry point that is their actual contract.
const PACKAGE_INTERNAL_PREFIXES = {
  'story-engine': '#engine/',
  'story-app': '#app/',
  'story-model': '#model/',
  'story-ai': '#ai/',
  'story-config': '#config/',
  'story-node': '#node/',
  'story-sim': '#sim/',
};

// The package's entry files (its package.json `exports`) and every folder `index.ts` re-export
// whole layers, so an import of one from inside the package hides where a name is defined and
// slips past the package's own layer check. Inside a package an import names the defining module.
function listEntryModules(name) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGES_ROOT, name, 'package.json'), 'utf8'),
  );
  return Object.values(manifest.exports ?? {})
    .map((target) => (typeof target === 'string' ? target : target.default))
    .filter((target) => typeof target === 'string')
    .map((target) => target.replace(/^\.\/src\//, '').replace(/\.ts$/, ''));
}

function isEntryOrBarrelImport(importPath, prefix, entryModules) {
  const subpath = importPath.slice(prefix.length);
  return entryModules.includes(subpath) || isBarrelModule(subpath);
}

function isBarrelModule(subpath) {
  return subpath === 'index' || subpath.endsWith('/index');
}

// An entry file or a folder barrel exists to gather barrels, and an import with no bindings (the
// provider registrations) names nothing whose home it could hide.
function isBarrelImportAllowed(statement, importerSubpath, entryModules) {
  const isImporterABarrel = entryModules.includes(importerSubpath) || isBarrelModule(importerSubpath);
  const isSideEffectImport = ts.isImportDeclaration(statement) && !statement.importClause;
  return isImporterABarrel || isSideEffectImport;
}

const summary = [];

function checkSharedPackages(failures) {
  for (const name of SHARED_PACKAGES) {
    const packageRoot = path.join(PACKAGES_ROOT, name, 'src');

    if (!fs.existsSync(packageRoot)) {
      failures.push(`${name} package missing at ${packageRoot}`);
      continue;
    }

    const files = collectSourceFiles(packageRoot);
    const prefix = PACKAGE_INTERNAL_PREFIXES[name];
    const entryModules = listEntryModules(name);
    const requirePrefix = requireAliasForSourceImport(packageRoot, prefix);
    summary.push(`${files.length} ${name}`);

    for (const filePath of files) {
      const relative = path.relative(packageRoot, filePath).replaceAll(path.sep, '/');
      const importerSubpath = relative.replace(/\.tsx?$/, '');
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

        if (importPath.startsWith('#') && !importPath.startsWith(prefix)) {
          failures.push(
            `${name} reaches into another package's internals: ${relative} -> ${importPath}`,
          );
        }

        requirePrefix(filePath, importPath, statement, (message, _from, target) => {
          const to = path.relative(packageRoot, target).replaceAll(path.sep, '/');
          failures.push(`${name} ${message}: ${relative} -> ${to}`);
        });

        if (
          importPath.startsWith(prefix) &&
          isEntryOrBarrelImport(importPath, prefix, entryModules) &&
          !isBarrelImportAllowed(statement, importerSubpath, entryModules)
        ) {
          failures.push(
            `${name} imports its own entry file or a folder barrel; import the defining module: ${relative} -> ${importPath}`,
          );
        }
      }
    }
  }
}

// 값 하나를 한 파일만 갖게 만들어 두어도, 다음 사람이 급할 때 리터럴을 다시 적으면 원래대로
// 돌아간다. 소유자가 정해진 문자열은 그 파일 밖에서 보이면 실패시킨다 — 테스트와 달리 이 검사는
// «아직 아무도 쓰지 않는 새 사본»도 잡는다.
const OWNED_LITERALS = [
  { literal: "'.storyboard/project.json'", owner: 'packages/story-model/src/format/paths.ts' },
  { literal: "'.sample.card'", owner: 'packages/story-model/src/format/sampleCard.ts' },
  {
    literal: "'storyboard.settings.open'",
    owner: 'apps/vscode/src/contributionIds.ts',
    // SECURITY: 웹뷰가 부를 수 있는 명령 목록은 익스텐션을 import 할 수 없는 패키지에 있어야 해서
    // 이 id 는 그곳에도 적힌다. 둘이 어긋나는지는 manifest.spec 이 본다.
    alsoAllowed: ['packages/story-model/src/shared/messaging/commands.ts'],
  },
  { literal: "'storyboard.card'", owner: 'apps/vscode/src/contributionIds.ts' },
  { literal: "'gpt-5.6-sol'", owner: 'packages/story-model/src/contracts/providerCatalog.ts' },
  {
    literal: "'http://localhost:11434'",
    owner: 'packages/story-model/src/contracts/providerCatalog.ts',
  },
];

const OWNED_LITERAL_ROOTS = [
  path.join(REPO_ROOT, 'apps', 'vscode', 'src'),
  path.join(REPO_ROOT, 'apps', 'vscode', 'webview-ui', 'src'),
  ...SHARED_PACKAGES.map((name) => path.join(PACKAGES_ROOT, name, 'src')),
  path.join(REPO_ROOT, 'apps', 'cli', 'src'),
  path.join(REPO_ROOT, 'apps', 'desktop', 'src'),
];

function checkOwnedLiterals(failures) {
  for (const root of OWNED_LITERAL_ROOTS) {
    if (!fs.existsSync(root)) {
      continue;
    }

    for (const filePath of collectSourceFiles(root)) {
      const relative = path.relative(REPO_ROOT, filePath).replaceAll(path.sep, '/');
      const text = fs.readFileSync(filePath, 'utf8');

      for (const { literal, owner, alsoAllowed = [] } of OWNED_LITERALS) {
        if (relative === owner || alsoAllowed.includes(relative) || !text.includes(literal)) {
          continue;
        }

        failures.push(`${relative} repeats ${literal}, which ${owner} owns`);
      }
    }
  }
}

const WEBVIEW_ROOT = path.join(REPO_ROOT, 'apps', 'vscode', 'webview-ui', 'src');

// The webview bundle has no architecture check of its own, so its alias rule is kept here.
function checkWebviewAliases(failures) {
  const requireWebviewAlias = requireAliasForSourceImport(WEBVIEW_ROOT, '@webview/');

  for (const filePath of collectSourceFiles(WEBVIEW_ROOT)) {
    for (const statement of parseSourceFile(filePath).statements) {
      const importPath = getImportPath(statement);

      if (!importPath) {
        continue;
      }

      requireWebviewAlias(filePath, importPath, statement, (message, from, target) => {
        const toRepo = (file) => path.relative(REPO_ROOT, file).replaceAll(path.sep, '/');
        failures.push(`webview ${message}: ${toRepo(from)} -> ${toRepo(target)}`);
      });
    }
  }
}

const failures = [];

checkSharedPackages(failures);
checkWebviewAliases(failures);
checkOwnedLiterals(failures);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Workspace architecture check failed: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Workspace architecture check passed: ${summary.join(', ')}, ${OWNED_LITERALS.length} owned literals.`,
  );
}
