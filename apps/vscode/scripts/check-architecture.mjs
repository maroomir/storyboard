import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

// NOTE: Anchored to this file, not the cwd, so the check is identical whether npm runs it from the
// monorepo root or from this package.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');
const EXTENSION_ENTRY = path.join(SOURCE_ROOT, 'extension.ts');
const PRESENTATION_ROOT = path.join(SOURCE_ROOT, 'presentation');
const INFRASTRUCTURE_ROOT = path.join(SOURCE_ROOT, 'infrastructure');
const BOOTSTRAP_ROOT = path.join(SOURCE_ROOT, 'bootstrap');

// Shared workspace package: every app consumes it, so it must stay runtime-agnostic and must never
// import back into an app.
const STORY_FORMAT_ROOT = path.resolve(PACKAGE_ROOT, '..', '..', 'packages', 'story-format', 'src');
const STORY_AI_ROOT = path.resolve(PACKAGE_ROOT, '..', '..', 'packages', 'story-ai', 'src');
const STORY_PIPELINE_ROOT = path.resolve(PACKAGE_ROOT, '..', '..', 'packages', 'story-pipeline', 'src');
const STORY_GIT_ROOT = path.resolve(PACKAGE_ROOT, '..', '..', 'packages', 'story-git', 'src');
const STORY_ENGINE_ROOT = path.resolve(PACKAGE_ROOT, '..', '..', 'packages', 'story-engine', 'src');
const ENGINE_SHARED_ROOT = path.join(STORY_ENGINE_ROOT, 'shared');


const sourceFiles = collectSourceFiles(SOURCE_ROOT);
const sourceFileSet = new Set(sourceFiles);
const graph = new Map(sourceFiles.map((filePath) => [filePath, new Set()]));
const failures = [];

for (const filePath of sourceFiles) {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  for (const statement of sourceFile.statements) {
    const importPath = getImportPath(statement);
    if (!importPath) {
      continue;
    }


    const target = resolveImport(filePath, importPath);
    if (target) {
      graph.get(filePath)?.add(target);
      validateInfrastructureBoundary(filePath, target);
    }
  }
}

for (const cycle of findCycles(graph)) {
  failures.push(`Import cycle: ${cycle.map(relativePath).join(' -> ')}`);
}

validateExtensionEntry();
const storyFormatFiles = validatePackagePurity(STORY_FORMAT_ROOT, 'story-format');
const storyAiFiles = validatePackagePurity(STORY_AI_ROOT, 'story-ai');
const storyPipelineFiles = validatePackagePurity(STORY_PIPELINE_ROOT, 'story-pipeline');
const storyGitFiles = validatePackagePurity(STORY_GIT_ROOT, 'story-git');
const storyEngineFiles = validatePackagePurity(STORY_ENGINE_ROOT, 'story-engine');
validateEngineSharedBoundary();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Architecture check failed: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Architecture check passed: ${sourceFiles.length} extension files, ` +
      `${storyEngineFiles} story-engine, ${storyFormatFiles} story-format, ` +
      `${storyAiFiles} story-ai, ${storyPipelineFiles} story-pipeline, ` +
      `${storyGitFiles} story-git files, no import cycles.`,
  );
}

function collectSourceFiles(directoryPath) {
  const files = [];

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath);
    }
  }

  return files;
}

function getImportPath(statement) {
  if (
    !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ||
    !statement.moduleSpecifier ||
    !ts.isStringLiteral(statement.moduleSpecifier)
  ) {
    return undefined;
  }

  return statement.moduleSpecifier.text;
}

function resolveImport(filePath, importPath) {
  let candidate;

  if (importPath.startsWith('@/')) {
    candidate = path.join(SOURCE_ROOT, importPath.slice(2));
  } else if (importPath.startsWith('.')) {
    candidate = path.resolve(path.dirname(filePath), importPath);
  } else {
    return undefined;
  }

  for (const target of [candidate, `${candidate}.ts`, path.join(candidate, 'index.ts')]) {
    if (sourceFileSet.has(target)) {
      return target;
    }
  }

  return undefined;
}

function findCycles(dependencyGraph) {
  const visited = new Set();
  const visiting = new Set();
  const stack = [];
  const cycles = [];

  function visit(filePath) {
    if (visiting.has(filePath)) {
      const cycleStart = stack.indexOf(filePath);
      cycles.push([...stack.slice(cycleStart), filePath]);
      return;
    }

    if (visited.has(filePath)) {
      return;
    }

    visiting.add(filePath);
    stack.push(filePath);

    for (const dependency of dependencyGraph.get(filePath) ?? []) {
      visit(dependency);
    }

    stack.pop();
    visiting.delete(filePath);
    visited.add(filePath);
  }

  for (const filePath of dependencyGraph.keys()) {
    visit(filePath);
  }

  return cycles;
}

// What is left in the extension after the engine took the inner layers: infrastructure adapts
// VSCode for the engine, presentation drives it, bootstrap wires them. An adapter that reaches into
// presentation would make the extension's own host layer depend on its UI.
function validateInfrastructureBoundary(filePath, target) {
  if (!isWithinDirectory(filePath, INFRASTRUCTURE_ROOT)) {
    return;
  }

  const forbiddenRoots = [PRESENTATION_ROOT, BOOTSTRAP_ROOT];

  if (forbiddenRoots.some((root) => isWithinDirectory(target, root))) {
    failures.push(
      `Infrastructure imports outer layer: ${relativePath(filePath)} -> ${relativePath(target)}`,
    );
  }
}

function validateExtensionEntry() {
  const sourceFile = ts.createSourceFile(
    EXTENSION_ENTRY,
    fs.readFileSync(EXTENSION_ENTRY, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );

  for (const statement of sourceFile.statements) {
    const importPath = getImportPath(statement);
    if (!importPath || importPath === 'vscode') {
      continue;
    }

    if (!importPath.startsWith('./bootstrap/')) {
      failures.push(`extension.ts imports outside bootstrap: ${importPath}`);
    }
  }
}

function validatePackagePurity(packageRoot, packageName) {
  if (!fs.existsSync(packageRoot)) {
    failures.push(`${packageName} package missing at ${packageRoot}`);
    return 0;
  }

  const packageFiles = collectSourceFiles(packageRoot);

  for (const filePath of packageFiles) {
    const sourceFile = ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );

    const relative = path.relative(packageRoot, filePath).replaceAll(path.sep, '/');

    // An inline `import('vscode').Uri` is not an import statement, so the loop below never sees it.
    // It still makes the package need the editor's types, which is the thing this check exists for.
    if (/\bimport\(\s*['"]vscode['"]\s*\)/.test(fs.readFileSync(filePath, 'utf8'))) {
      failures.push(`${packageName} references vscode types inline: ${relative}`);
    }

    for (const statement of sourceFile.statements) {
      const importPath = getImportPath(statement);
      if (!importPath) {
        continue;
      }

      if (importPath === 'vscode') {
        failures.push(`${packageName} imports vscode: ${relative}`);
      }

      if (importPath.startsWith('@/') || importPath.startsWith('@webview/')) {
        failures.push(`${packageName} imports an app module: ${relative} -> ${importPath}`);
      }
    }
  }

  return packageFiles.length;
}

// Inside the engine, `shared` is the contract floor: it may import itself and nothing else, so a
// contract type can never drag domain logic into a webview or a CLI that only speaks the protocol.
function validateEngineSharedBoundary() {
  for (const filePath of collectSourceFiles(ENGINE_SHARED_ROOT)) {
    const sourceFile = ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );

    for (const statement of sourceFile.statements) {
      const importPath = getImportPath(statement);
      if (!importPath || !importPath.startsWith('.')) {
        continue;
      }

      const target = resolveImport(filePath, importPath);
      if (target && !isWithinDirectory(target, ENGINE_SHARED_ROOT)) {
        failures.push(
          `story-engine shared imports outside itself: ${relativePath(filePath)} -> ${relativePath(target)}`,
        );
      }
    }
  }
}

function isTypeOnlyImport(statement) {
  if (!ts.isImportDeclaration(statement)) {
    return false;
  }

  return statement.importClause?.isTypeOnly === true;
}

function isWithinDirectory(filePath, directoryPath) {
  return filePath === directoryPath || filePath.startsWith(`${directoryPath}${path.sep}`);
}

function relativePath(filePath) {
  return path.relative(PACKAGE_ROOT, filePath).replaceAll(path.sep, '/');
}
