import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  allowListRule,
  isWithin,
  requireAliasForEscapingImport,
  runArchitectureCheck,
} from '../../../scripts/architecture/runner.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');
const RENDERER_ROOT = path.join(SOURCE_ROOT, 'renderer');
const PRELOAD_ROOT = path.join(SOURCE_ROOT, 'preload');
const SHARED_ROOT = path.join(SOURCE_ROOT, 'shared');

// One folder per Electron process. They meet only through `shared` (the IPC contract and the
// messages), so the renderer can never grow a path to the file system or the engine.
const ALLOWED_IMPORTS = {
  shared: ['shared'],
  main: ['main', 'shared'],
  preload: ['preload', 'shared'],
  renderer: ['renderer', 'shared'],
};

// The browser-safe entries the renderer and the contract may reach. Everything else a package
// exports may pull node-only modules into the page.
const BROWSER_SAFE_PACKAGES = new Set([
  '@storyboard/story-engine/contracts',
  '@storyboard/story-format/contracts',
  '@storyboard/story-ai/contracts',
]);

const NODE_BUILTIN = /^(node:|fs$|path$|os$|child_process$|crypto$)/;

function isBrowserSide(filePath) {
  return isWithin(filePath, RENDERER_ROOT) || isWithin(filePath, SHARED_ROOT);
}

function refuseNodeReachFromTheBrowserSide(filePath, importPath, _statement, report) {
  if (!isBrowserSide(filePath)) {
    return;
  }

  if (NODE_BUILTIN.test(importPath) || importPath === 'electron') {
    report(`browser-side code imports ${importPath}`, filePath);
  }

  if (importPath.startsWith('@storyboard/') && !BROWSER_SAFE_PACKAGES.has(importPath)) {
    report(`browser-side code imports ${importPath}; use a /contracts entry`, filePath);
  }
}

// A sandboxed preload can require nothing but Electron; anything else must be bundled from shared.
function refusePreloadDependencies(filePath, importPath, _statement, report) {
  if (!isWithin(filePath, PRELOAD_ROOT) || importPath.startsWith('@/') || importPath.startsWith('.')) {
    return;
  }

  if (importPath !== 'electron') {
    report(`preload imports ${importPath}`, filePath);
  }
}

// Same rule as the CLI: orchestration belongs to the engine, so the desktop drives use cases and
// never assembles pipeline stages itself.
function refuseDirectPipelineImport(filePath, importPath, _statement, report) {
  if (importPath === '@storyboard/story-pipeline') {
    report('desktop imports the pipeline directly instead of an engine use case', filePath);
  }
}

function refuseUiLibrariesOutsideRenderer(filePath, importPath, _statement, report) {
  if (isWithin(filePath, RENDERER_ROOT)) {
    return;
  }

  if (importPath === 'react' || importPath.startsWith('react-dom') || importPath.startsWith('react/')) {
    report(`${importPath} outside the renderer`, filePath);
  }
}

runArchitectureCheck('Desktop', SOURCE_ROOT, {
  rules: [allowListRule(ALLOWED_IMPORTS, SOURCE_ROOT)],
  importRules: [
    refuseNodeReachFromTheBrowserSide,
    refusePreloadDependencies,
    refuseDirectPipelineImport,
    refuseUiLibrariesOutsideRenderer,
    requireAliasForEscapingImport(SOURCE_ROOT, '@/'),
  ],
  aliases: { '@/': '@/' },
});
