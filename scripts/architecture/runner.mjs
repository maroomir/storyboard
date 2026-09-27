import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import ts from 'typescript';

// Every app and the engine used to carry its own copy of this walk. The rules differ per package;
// the walk does not, and four copies had already drifted (only one resolved the `@/` alias).

export function isWithin(filePath, directory) {
  const relative = path.relative(directory, filePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// An import that climbs out of its own folder must go through the project's alias. Relative chains
// break the moment a file moves, and they are what the alias exists to replace. An escape that
// lands outside the source root (a manifest, say) is none of this rule's business.
export function requireAliasForEscapingImport(sourceRoot, alias) {
  return (filePath, importPath, _statement, report) => {
    if (!importPath.startsWith('../')) {
      return;
    }

    const target = path.resolve(path.dirname(filePath), importPath);

    if (!isWithin(target, sourceRoot)) {
      return;
    }

    report(`Relative import escapes its folder; use ${alias}`, filePath, target);
  };
}

export function collectSourceFiles(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  const files = [];

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(entryPath);
    }
  }

  return files;
}

export function getImportPath(statement) {
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

export function parseSourceFile(filePath) {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}

export function findCycles(importGraph) {
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

// A layer may import itself and anything to its left.
export function orderedLayerRule(layerOrder, sourceRoot) {
  return (filePath, target, report) => {
    const from = layerOf(filePath, sourceRoot);
    const to = layerOf(target, sourceRoot);

    if (from === undefined || to === undefined || from === to) {
      return;
    }

    const fromIndex = layerOrder.indexOf(from);
    const toIndex = layerOrder.indexOf(to);

    if (fromIndex === -1) {
      report(`unknown layer '${from}'`, filePath, target);
      return;
    }

    if (toIndex > fromIndex) {
      report(`${from} imports ${to}, which is to its right`, filePath, target);
    }
  };
}

// An explicit allow-list per layer, for graphs that are not a straight line.
export function allowListRule(allowedImports, sourceRoot) {
  return (filePath, target, report) => {
    const from = layerOf(filePath, sourceRoot);
    const to = layerOf(target, sourceRoot);
    const allowed = from === undefined ? undefined : allowedImports[from];

    if (!allowed || to === undefined || allowed.includes(to)) {
      return;
    }

    report(`${from} imports ${to} (may import ${allowed.join(', ')})`, filePath, target);
  };
}

export function layerOf(filePath, sourceRoot) {
  const relative = path.relative(sourceRoot, filePath).replaceAll(path.sep, '/');
  const [first] = relative.split('/');
  return relative.includes('/') ? first : undefined;
}

/**
 * Walks a package's sources once, applies the given rules, and reports cycles.
 *
 * @param label      what to call this package in the output
 * @param sourceRoot absolute path to the package's `src`
 * @param options    { rules, importRules, aliases, extraChecks, extraSummary }
 */
export function runArchitectureCheck(label, sourceRoot, options = {}) {
  const { rules = [], importRules = [], aliases = {}, extraChecks = [], extraSummary = '' } = options;
  const sourceFiles = collectSourceFiles(sourceRoot);
  const graph = new Map(sourceFiles.map((filePath) => [filePath, new Set()]));
  const failures = [];

  const report = (message, filePath, target) => {
    const from = path.relative(sourceRoot, filePath).replaceAll(path.sep, '/');
    const to = target ? ` -> ${path.relative(sourceRoot, target).replaceAll(path.sep, '/')}` : '';
    failures.push(`${message}: ${from}${to}`);
  };

  for (const filePath of sourceFiles) {
    const sourceFile = parseSourceFile(filePath);

    for (const statement of sourceFile.statements) {
      const importPath = getImportPath(statement);

      if (!importPath) {
        continue;
      }

      for (const rule of importRules) {
        rule(filePath, importPath, statement, report);
      }

      const target = resolveImport(filePath, importPath, sourceRoot, aliases);

      if (!target) {
        continue;
      }

      graph.get(filePath)?.add(target);

      for (const rule of rules) {
        rule(filePath, target, report);
      }
    }
  }

  for (const cycle of findCycles(graph)) {
    failures.push(
      `Import cycle: ${cycle.map((f) => path.relative(sourceRoot, f).replaceAll(path.sep, '/')).join(' -> ')}`,
    );
  }

  for (const check of extraChecks) {
    check(report, failures);
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`${label} architecture check failed: ${failure}`);
    }
    process.exitCode = 1;
    return failures;
  }

  const summary = typeof extraSummary === 'function' ? extraSummary() : extraSummary;

  console.log(
    `${label} architecture check passed: ${sourceFiles.length} files${summary}, no import cycles.`,
  );
  return [];
}

export function resolveImport(fromFile, importPath, sourceRoot, aliases) {
  let base;

  if (importPath.startsWith('.')) {
    base = path.resolve(path.dirname(fromFile), importPath);
  } else {
    const alias = Object.keys(aliases).find((prefix) => importPath.startsWith(prefix));

    if (!alias) {
      return undefined;
    }

    base = path.join(sourceRoot, importPath.slice(aliases[alias].length));
  }

  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}
