import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import ts from 'typescript';

const REPOSITORY_ROOT = process.cwd();
const SOURCE_ROOT = path.join(REPOSITORY_ROOT, 'src');
const EXTENSION_ENTRY = path.join(SOURCE_ROOT, 'extension.ts');
const SHARED_ROOT = path.join(SOURCE_ROOT, 'shared');
const APPLICATION_ROOT = path.join(SOURCE_ROOT, 'application');
const DOMAIN_ROOT = path.join(SOURCE_ROOT, 'domain');
const PRESENTATION_ROOT = path.join(SOURCE_ROOT, 'presentation');
const INFRASTRUCTURE_ROOT = path.join(SOURCE_ROOT, 'infrastructure');
const BOOTSTRAP_ROOT = path.join(SOURCE_ROOT, 'bootstrap');
const COMMANDS_ROOT = path.join(SOURCE_ROOT, 'presentation', 'commands');
const PROVIDERS_ROOT = path.join(SOURCE_ROOT, 'presentation', 'providers');
const AI_SERVICE_PATH = path.join(SOURCE_ROOT, 'infrastructure', 'ai', 'AIService.ts');

// Compat boundary: application code still touching vscode at runtime; converge behind ports then remove.
const APPLICATION_RUNTIME_VSCODE_ALLOWLIST = new Set([
  path.join(APPLICATION_ROOT, 'drafts', 'reviseAfterGenerateGate.ts'),
  path.join(APPLICATION_ROOT, 'drafts', 'generateDraftUseCase.ts'),
  path.join(APPLICATION_ROOT, 'drafts', 'sceneGenerationInputs.ts'),
  path.join(APPLICATION_ROOT, 'drafts', 'reviseDraftUseCase.ts'),
]);

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

    validateDomainVscodeBoundary(filePath, importPath);
    validateApplicationVscodeBoundary(filePath, statement, importPath);

    const target = resolveImport(filePath, importPath);
    if (target) {
      graph.get(filePath)?.add(target);
      validateSharedBoundary(filePath, target);
      validateDomainBoundary(filePath, target);
      validateApplicationBoundary(filePath, target);
      validatePresentationAiBoundary(filePath, statement, target);
    }
  }
}

for (const cycle of findCycles(graph)) {
  failures.push(`Import cycle: ${cycle.map(relativePath).join(' -> ')}`);
}

validateExtensionEntry();

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Architecture check failed: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Architecture check passed: ${sourceFiles.length} source files, no import cycles.`);
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

function validateSharedBoundary(filePath, target) {
  if (isWithinDirectory(filePath, SHARED_ROOT) && !isWithinDirectory(target, SHARED_ROOT)) {
    failures.push(
      `Shared layer imports outside itself: ${relativePath(filePath)} -> ${relativePath(target)}`,
    );
  }
}

function validateDomainBoundary(filePath, target) {
  if (!isWithinDirectory(filePath, DOMAIN_ROOT)) {
    return;
  }

  const forbiddenRoots = [APPLICATION_ROOT, INFRASTRUCTURE_ROOT, PRESENTATION_ROOT, BOOTSTRAP_ROOT];
  if (forbiddenRoots.some((root) => isWithinDirectory(target, root))) {
    failures.push(
      `Domain layer imports outer layer: ${relativePath(filePath)} -> ${relativePath(target)}`,
    );
  }
}

function validateDomainVscodeBoundary(filePath, importPath) {
  if (isWithinDirectory(filePath, DOMAIN_ROOT) && importPath === 'vscode') {
    failures.push(`Domain layer imports vscode: ${relativePath(filePath)}`);
  }
}

function validateApplicationBoundary(filePath, target) {
  if (!isWithinDirectory(filePath, APPLICATION_ROOT)) {
    return;
  }

  if (isWithinDirectory(target, PRESENTATION_ROOT) || isWithinDirectory(target, BOOTSTRAP_ROOT)) {
    failures.push(
      `Application layer imports outer layer: ${relativePath(filePath)} -> ${relativePath(target)}`,
    );
  }
}

function validateApplicationVscodeBoundary(filePath, statement, importPath) {
  if (
    !isWithinDirectory(filePath, APPLICATION_ROOT) ||
    importPath !== 'vscode' ||
    isTypeOnlyImport(statement) ||
    APPLICATION_RUNTIME_VSCODE_ALLOWLIST.has(filePath)
  ) {
    return;
  }

  failures.push(`Application layer imports vscode at runtime: ${relativePath(filePath)}`);
}

function validatePresentationAiBoundary(filePath, statement, target) {
  if (
    target !== AI_SERVICE_PATH ||
    !(isWithinDirectory(filePath, COMMANDS_ROOT) || isWithinDirectory(filePath, PROVIDERS_ROOT)) ||
    isTypeOnlyImport(statement)
  ) {
    return;
  }

  failures.push(
    `Presentation imports AIService at runtime: ${relativePath(filePath)} -> ${relativePath(target)}`,
  );
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
  return path.relative(REPOSITORY_ROOT, filePath).replaceAll(path.sep, '/');
}
