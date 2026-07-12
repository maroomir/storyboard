import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import ts from 'typescript'

const REPOSITORY_ROOT = process.cwd()
const SOURCE_ROOT = path.join(REPOSITORY_ROOT, 'src')
const EXTENSION_ENTRY = path.join(SOURCE_ROOT, 'extension.ts')

const sourceFiles = collectSourceFiles(SOURCE_ROOT)
const sourceFileSet = new Set(sourceFiles)
const graph = new Map(sourceFiles.map((filePath) => [filePath, new Set()]))
const failures = []

for (const filePath of sourceFiles) {
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )

  for (const statement of sourceFile.statements) {
    const importPath = getImportPath(statement)
    if (!importPath) {
      continue
    }

    const target = resolveImport(filePath, importPath)
    if (target) {
      graph.get(filePath)?.add(target)
    }
  }
}

for (const cycle of findCycles(graph)) {
  failures.push(`Import cycle: ${cycle.map(relativePath).join(' -> ')}`)
}

validateExtensionEntry()

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`Architecture check failed: ${failure}`)
  }
  process.exitCode = 1
} else {
  console.log(`Architecture check passed: ${sourceFiles.length} source files, no import cycles.`)
}

function collectSourceFiles(directoryPath) {
  const files = []

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name)

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath))
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(entryPath)
    }
  }

  return files
}

function getImportPath(statement) {
  if (
    !(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) ||
    !statement.moduleSpecifier ||
    !ts.isStringLiteral(statement.moduleSpecifier)
  ) {
    return undefined
  }

  return statement.moduleSpecifier.text
}

function resolveImport(filePath, importPath) {
  let candidate

  if (importPath.startsWith('@/')) {
    candidate = path.join(SOURCE_ROOT, importPath.slice(2))
  } else if (importPath.startsWith('.')) {
    candidate = path.resolve(path.dirname(filePath), importPath)
  } else {
    return undefined
  }

  for (const target of [candidate, `${candidate}.ts`, path.join(candidate, 'index.ts')]) {
    if (sourceFileSet.has(target)) {
      return target
    }
  }

  return undefined
}

function findCycles(dependencyGraph) {
  const visited = new Set()
  const visiting = new Set()
  const stack = []
  const cycles = []

  function visit(filePath) {
    if (visiting.has(filePath)) {
      const cycleStart = stack.indexOf(filePath)
      cycles.push([...stack.slice(cycleStart), filePath])
      return
    }

    if (visited.has(filePath)) {
      return
    }

    visiting.add(filePath)
    stack.push(filePath)

    for (const dependency of dependencyGraph.get(filePath) ?? []) {
      visit(dependency)
    }

    stack.pop()
    visiting.delete(filePath)
    visited.add(filePath)
  }

  for (const filePath of dependencyGraph.keys()) {
    visit(filePath)
  }

  return cycles
}

function validateExtensionEntry() {
  const sourceFile = ts.createSourceFile(
    EXTENSION_ENTRY,
    fs.readFileSync(EXTENSION_ENTRY, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )

  for (const statement of sourceFile.statements) {
    const importPath = getImportPath(statement)
    if (!importPath || importPath === 'vscode') {
      continue
    }

    if (!importPath.startsWith('./bootstrap/')) {
      failures.push(`extension.ts imports outside bootstrap: ${importPath}`)
    }
  }
}

function relativePath(filePath) {
  return path.relative(REPOSITORY_ROOT, filePath).replaceAll(path.sep, '/')
}
