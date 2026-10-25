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

// The entry files at the root (`index.ts`, `contracts.ts`) and each folder's `index.ts` re-export
// every layer, so importing one from inside the package hides which layer a name comes from and
// slips past the allow-list above. Inside the package an import names the module that defines it.
const ENTRY_OR_BARREL_IMPORT = /^#model\/(?:[^/]+|.+\/index)$/;

function refuseEntryAndBarrelImports(filePath, importPath, _statement, report) {
  if (ENTRY_OR_BARREL_IMPORT.test(importPath)) {
    report(
      `Import names an entry file or a folder barrel (${importPath}); import the defining module`,
      filePath,
    );
  }
}

runArchitectureCheck('Model', SOURCE_ROOT, {
  rules: [allowListRule(ALLOWED_IMPORTS, SOURCE_ROOT)],
  importRules: [requireAliasForEscapingImport(SOURCE_ROOT, '#model/'), refuseEntryAndBarrelImports],
  aliases: { '#model/': '#model/' },
});
