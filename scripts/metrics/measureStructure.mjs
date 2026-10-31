#!/usr/bin/env node
// Measures the structural facts the integration refactor is changing, so a PR can show the
// before and after with one command: `npm run metrics`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_ROOTS = [
  'apps/cli/src',
  'apps/vscode/src',
  'apps/vscode/webview-ui/src',
  'packages/story-model/src',
  'packages/story-ai/src',
  'packages/story-engine/src',
  'packages/story-app/src',
  'packages/story-sim/src',
  'packages/story-config/src',
  'packages/story-node/src',
];
const BAG_PARAMETER_NAMES = new Set(['input', 'options', 'deps', 'request', 'args']);
const LARGE_FILE_LINES = 1000;

function collectSourceFiles(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(entryPath);
    }
    const isSource = /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.generated.ts');
    return isSource ? [entryPath] : [];
  });
}

function parse(filePath) {
  const kind = filePath.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
}

function lineCount(sourceFile) {
  return sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1;
}

function isBagFunction(node, sourceFile) {
  if (!ts.isFunctionDeclaration(node) || node.parameters.length !== 1) {
    return false;
  }
  const [parameter] = node.parameters;
  const isObjectLiteralType = parameter.type !== undefined && ts.isTypeLiteralNode(parameter.type);
  return isObjectLiteralType && BAG_PARAMETER_NAMES.has(parameter.name.getText(sourceFile));
}

function countPickReferences(sourceFile) {
  let count = 0;
  const visit = (node) => {
    if (ts.isTypeReferenceNode(node) && node.typeName.getText(sourceFile) === 'Pick') {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return count;
}

function measure() {
  const totals = {
    files: 0,
    lines: 0,
    largeFiles: [],
    dependencyBags: [],
    bagFunctions: 0,
    pickReferences: 0,
    exportedTypes: 0,
    useCaseClasses: 0,
  };

  for (const root of SOURCE_ROOTS) {
    for (const filePath of collectSourceFiles(path.join(REPO_ROOT, root))) {
      const sourceFile = parse(filePath);
      const relative = path.relative(REPO_ROOT, filePath);
      const lines = lineCount(sourceFile);
      totals.files += 1;
      totals.lines += lines;
      if (lines >= LARGE_FILE_LINES) {
        totals.largeFiles.push(`${relative} (${lines})`);
      }
      totals.pickReferences += countPickReferences(sourceFile);

      for (const statement of sourceFile.statements) {
        const isExported = statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (
          (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) &&
          isExported
        ) {
          totals.exportedTypes += 1;
        }
        if (ts.isInterfaceDeclaration(statement) && /Dependencies$/.test(statement.name.text)) {
          totals.dependencyBags.push(statement.members.length);
        }
        if (isBagFunction(statement, sourceFile)) {
          totals.bagFunctions += 1;
        }
        if (
          ts.isClassDeclaration(statement) &&
          statement.name &&
          /UseCase$/.test(statement.name.text)
        ) {
          totals.useCaseClasses += 1;
        }
      }
    }
  }

  return totals;
}

function formatReport(totals) {
  const bagCount = totals.dependencyBags.length;
  const bagFieldsAverage =
    bagCount === 0 ? 0 : totals.dependencyBags.reduce((a, b) => a + b, 0) / bagCount;
  const bagFieldsMax = bagCount === 0 ? 0 : Math.max(...totals.dependencyBags);
  const rows = [
    ['source files', totals.files],
    ['source lines', totals.lines],
    [`files ≥ ${LARGE_FILE_LINES} lines`, totals.largeFiles.length],
    ['dependency bags (*Dependencies)', bagCount],
    ['  fields per bag (avg / max)', `${bagFieldsAverage.toFixed(1)} / ${bagFieldsMax}`],
    ['bag-parameter functions', totals.bagFunctions],
    ['Pick<> references', totals.pickReferences],
    ['exported types', totals.exportedTypes],
    ['use case classes', totals.useCaseClasses],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  const lines = rows.map(([label, value]) => `${label.padEnd(width)}  ${value}`);
  return [...lines, '', ...totals.largeFiles.sort().map((entry) => `  ${entry}`)].join('\n');
}

const totals = measure();
if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(totals)}\n`);
} else {
  process.stdout.write(`${formatReport(totals)}\n`);
}
