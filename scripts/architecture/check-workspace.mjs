import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { collectSourceFiles, getImportPath, parseSourceFile } from './runner.mjs';

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
  'story-pipeline',
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
  'story-pipeline': '#pipeline/',
  'story-config': '#config/',
  'story-node': '#node/',
  'story-sim': '#sim/',
};

const summary = [];

function checkSharedPackages(failures) {
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

// 값 하나를 한 파일만 갖게 만들어 두어도, 다음 사람이 급할 때 리터럴을 다시 적으면 원래대로
// 돌아간다. 소유자가 정해진 문자열은 그 파일 밖에서 보이면 실패시킨다 — 테스트와 달리 이 검사는
// «아직 아무도 쓰지 않는 새 사본»도 잡는다.
const OWNED_LITERALS = [
  { literal: "'.storyboard/project.json'", owner: 'packages/story-model/src/format/paths.ts' },
  { literal: "'.sample.card'", owner: 'packages/story-model/src/format/sampleCard.ts' },
  {
    literal: "'storyboard.settings.open'",
    owner: 'apps/vscode/src/presentation/commands/openSettings.ts',
    // SECURITY: 웹뷰가 부를 수 있는 명령 목록은 익스텐션을 import 할 수 없는 패키지에 있어야 해서
    // 이 id 는 그곳에도 적힌다. 둘이 어긋나는지는 manifest.spec 이 본다.
    alsoAllowed: ['packages/story-engine/src/shared/messaging/commands.ts'],
  },
  { literal: "'storyboard.card'", owner: 'apps/vscode/src/contributionIds.ts' },
  { literal: "'gpt-5.6-sol'", owner: 'packages/story-ai/src/contracts/providerCatalog.ts' },
  { literal: "'http://localhost:11434'", owner: 'packages/story-ai/src/contracts/providerCatalog.ts' },
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

const failures = [];

checkSharedPackages(failures);
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
