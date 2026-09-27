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
  'story-config',
  'story-node',
  'story-sim',
];
// Each package addresses its own files through a Node subpath import declared in its package.json.
// The prefix is private to the package: reaching for another one's would bind two packages through
// a path instead of through the entry point that is their actual contract.
const PACKAGE_INTERNAL_PREFIXES = {
  'story-engine': '#engine/',
  'story-format': '#format/',
  'story-ai': '#ai/',
  'story-pipeline': '#pipeline/',
  'story-config': '#config/',
  'story-node': '#node/',
  'story-sim': '#sim/',
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

// 값 하나를 한 파일만 갖게 만들어 두어도, 다음 사람이 급할 때 리터럴을 다시 적으면 원래대로
// 돌아간다. 소유자가 정해진 문자열은 그 파일 밖에서 보이면 실패시킨다 — 테스트와 달리 이 검사는
// «아직 아무도 쓰지 않는 새 사본»도 잡는다.
const OWNED_LITERALS = [
  { literal: "'.storyboard/project.json'", owner: 'packages/story-format/src/paths.ts' },
  { literal: "'.sample.card'", owner: 'packages/story-format/src/sampleCard.ts' },
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

const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..');

function checkOwnedLiterals(_report, failures) {
  const roots = [SOURCE_ROOT, path.join(PACKAGE_ROOT, 'webview-ui', 'src')].concat(
    SHARED_PACKAGES.map((name) => path.join(PACKAGES_ROOT, name, 'src')),
    [path.join(REPO_ROOT, 'apps', 'cli', 'src')],
  );

  for (const root of roots) {
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

runArchitectureCheck('Extension', SOURCE_ROOT, {
  rules: [refuseInfrastructureReachingOutward],
  importRules: [refuseWideExtensionEntry, requireAliasForEscapingImport(SOURCE_ROOT, '@/')],
  aliases: { '@/': '@/' },
  extraChecks: [checkSharedPackages, checkEngineSharedFloor, checkOwnedLiterals],
  extraSummary: () => (summary.length > 0 ? `, ${summary.join(', ')}` : ''),
});
