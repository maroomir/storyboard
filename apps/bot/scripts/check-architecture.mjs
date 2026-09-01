import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { orderedLayerRule, runArchitectureCheck } from '../../../scripts/architecture/runner.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');

const LAYER_ORDER = [
  'util',
  'config',
  'store',
  'workspace',
  'sync',
  'content',
  'ai',
  'provider',
  'gen',
  'chat',
  'telegram',
  'dashboard',
  'app',
];

// The bot is born without seedcoat: story content lives in the git workspace, never in a .seed
// archive. A reappearing seed import means someone reintroduced that store.
function refuseSeedDependency(filePath, importPath, _statement, report) {
  if (importPath.startsWith('@seedcoat/') || /(^|\/)seed(\/|$)/.test(importPath)) {
    report(`seed dependency reintroduced (${importPath})`, filePath);
  }
}

runArchitectureCheck('Bot', SOURCE_ROOT, {
  rules: [orderedLayerRule(LAYER_ORDER, SOURCE_ROOT)],
  importRules: [refuseSeedDependency],
});
