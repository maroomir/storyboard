import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

// NOTE: anchored to this file, not the cwd, so the check is identical whether npm runs it from the
// monorepo root or from this package.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');

// What each layer may reach. `persistence` and `application` are deliberately absent: they are a
// mutually dependent pair — application declares the repository ports, persistence implements them
// — so there is no order to enforce between the two. Everything inward of them does have one.
const ALLOWED_IMPORTS = {
  shared: ['shared'],
  domain: ['domain', 'shared'],
  paths: ['paths', 'domain', 'shared'],
  ports: ['ports', 'paths', 'domain'],
  ai: ['ai', 'domain', 'shared'],
};

const sourceFiles = collectSourceFiles(SOURCE_ROOT);
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

    if (!importPath || !importPath.startsWith('.')) {
      continue;
    }

    const target = resolveImport(filePath, importPath);

    if (!target) {
      continue;
    }

    graph.get(filePath)?.add(target);
    validateLayerDirection(filePath, target);
  }
}

for (const cycle of findCycles(graph)) {
  failures.push(`Import cycle: ${cycle.map(relativePath).join(' -> ')}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Engine architecture check failed: ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Engine architecture check passed: ${sourceFiles.length} files, no import cycles.`);
}

function layerOf(filePath) {
  const relative = path.relative(SOURCE_ROOT, filePath).replaceAll(path.sep, '/');
  const [first] = relative.split('/');
  return relative.includes('/') ? first : undefined;
}

function validateLayerDirection(filePath, target) {
  const from = layerOf(filePath);
  const to = layerOf(target);
  const allowed = from === undefined ? undefined : ALLOWED_IMPORTS[from];

  if (!allowed || to === undefined || allowed.includes(to)) {
    return;
  }

  failures.push(
    `${from} imports ${to}: ${relativePath(filePath)} -> ${relativePath(target)} ` +
      `(${from} may import ${allowed.join(', ')})`,
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
  if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
    return statement.moduleSpecifier.text;
  }

  if (
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)
  ) {
    return statement.moduleSpecifier.text;
  }

  return undefined;
}

function resolveImport(fromFile, importPath) {
  const base = path.resolve(path.dirname(fromFile), importPath);

  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function findCycles(importGraph) {
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();

  function walk(node, stack) {
    if (visiting.has(node)) {
      cycles.push([...stack.slice(stack.indexOf(node)), node]);
      return;
    }

    if (visited.has(node)) {
      return;
    }

    visiting.add(node);

    for (const next of importGraph.get(node) ?? []) {
      walk(next, [...stack, next]);
    }

    visiting.delete(node);
    visited.add(node);
  }

  for (const node of importGraph.keys()) {
    walk(node, [node]);
  }

  return cycles;
}

function relativePath(filePath) {
  return path.relative(PACKAGE_ROOT, filePath).replaceAll(path.sep, '/');
}
