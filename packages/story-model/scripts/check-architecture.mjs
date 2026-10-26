import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  allowListRule,
  requireAliasForEscapingImport,
  runArchitectureCheck,
} from '../../../scripts/architecture/runner.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');

// One folder per origin, each reaching only inward: the file format knows nothing else, the AI
// contracts speak in format terms, the shared contracts in both, and the policies and path rules
// sit on top.
const ALLOWED_IMPORTS = {
  format: ['format'],
  contracts: ['contracts', 'format'],
  shared: ['shared', 'contracts', 'format'],
  domain: ['domain', 'shared', 'contracts', 'format'],
  paths: ['paths', 'domain', 'shared', 'contracts', 'format'],
};

runArchitectureCheck('Model', SOURCE_ROOT, {
  rules: [allowListRule(ALLOWED_IMPORTS, SOURCE_ROOT)],
  importRules: [requireAliasForEscapingImport(SOURCE_ROOT, '#model/')],
  aliases: { '#model/': '#model/' },
});
