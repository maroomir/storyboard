import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  allowListRule,
  requireAliasForSourceImport,
  runArchitectureCheck,
} from '../../../scripts/architecture/runner.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');

// One folder per origin, each reaching only inward: the element vocabulary knows nothing else, the
// file format speaks in element terms, the AI contracts in format terms, the shared contracts in
// those, and the policies and path rules sit on top.
const ALLOWED_IMPORTS = {
  element: ['element'],
  format: ['format', 'element'],
  contracts: ['contracts', 'format', 'element'],
  shared: ['shared', 'contracts', 'format', 'element'],
  domain: ['domain', 'shared', 'contracts', 'format', 'element'],
  paths: ['paths', 'domain', 'shared', 'contracts', 'format', 'element'],
};

runArchitectureCheck('Model', SOURCE_ROOT, {
  rules: [allowListRule(ALLOWED_IMPORTS, SOURCE_ROOT)],
  importRules: [requireAliasForSourceImport(SOURCE_ROOT, '#model/')],
  aliases: { '#model/': '#model/' },
});
