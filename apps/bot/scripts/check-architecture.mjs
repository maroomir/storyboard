import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

// NOTE: Anchored to this file, not the cwd, so the check is identical whether npm runs it from the
// monorepo root or from this package.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');

// Layer order: a layer may import itself and anything to its left, never to its right.
const LAYER_ORDER = ['util', 'config', 'store', 'workspace', 'sync', 'content', 'ai', 'provider', 'gen', 'chat', 'telegram', 'dashboard', 'app'];

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

    validateNoSeedDependency(filePath, importPath);

    const target = resolveImport(filePath, importPath);
    if (target) {
      graph.get(filePath)?.add(target);
      validateLayerDirection(filePath, target);
    }
  }
}

for (const cycle of findCycles(graph)) {
  failures.push(`Import cycle: ${cycle.map(relativePath).join(' -> ')}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Architecture check failed: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Architecture check passed: ${sourceFiles.length} source files, no import cycles.`);
}

// The bot is born without seedcoat: story content lives in the git workspace, never in a .seed
// archive. Catch any reintroduction at the import boundary.
function validateNoSeedDependency(filePath, importPath) {
  if (importPath.startsWith('@seedcoat/') || /(^|\/)seed(\/|$)/.test(importPath)) {
    failures.push(`seed dependency reintroduced: ${relativePath(filePath)} -> ${importPath}`);
  }
}

function layerOf(filePath) {
  const relative = path.relative(SOURCE_ROOT, filePath);
  const segment = relative.split(path.sep)[0];
  return segment.endsWith('.ts') ? undefined : segment;
}

function validateLayerDirection(filePath, target) {
  const from = layerOf(filePath);
  const to = layerOf(target);

  if (from === undefined || to === undefined || from === to) {
    return;
  }

  const fromIndex = LAYER_ORDER.indexOf(from);
  const toIndex = LAYER_ORDER.indexOf(to);

  if (fromIndex === -1 || toIndex === -1) {
    failures.push(`Unknown layer in import: ${relativePath(filePath)} -> ${relativePath(target)}`);
    return;
  }

  if (toIndex > fromIndex) {
    failures.push(
      `Layer '${from}' imports outer layer '${to}': ${relativePath(filePath)} -> ${relativePath(target)}`,
    );
  }
}

function collectSourceFiles(directoryPath) {
  const files = [];

  if (!fs.existsSync(directoryPath)) {
    return files;
  }

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
  if (!importPath.startsWith('.')) {
    return undefined;
  }

  const candidate = path.resolve(path.dirname(filePath), importPath);

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

function relativePath(filePath) {
  return path.relative(PACKAGE_ROOT, filePath).replaceAll(path.sep, '/');
}
