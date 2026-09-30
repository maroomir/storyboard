import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isWithin,
  requireAliasForEscapingImport,
  runArchitectureCheck,
} from '../../../scripts/architecture/runner.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');
const EXTENSION_ENTRY = path.join(SOURCE_ROOT, 'extension.ts');
const PRESENTATION_ROOT = path.join(SOURCE_ROOT, 'presentation');
const INFRASTRUCTURE_ROOT = path.join(SOURCE_ROOT, 'infrastructure');
const BOOTSTRAP_ROOT = path.join(SOURCE_ROOT, 'bootstrap');

// What is left in the extension after the engine took the inner layers: infrastructure adapts
// VSCode for the engine, presentation drives it, bootstrap wires them. An adapter that reaches into
// presentation would make the extension's own host layer depend on its UI.
function refuseInfrastructureReachingOutward(filePath, target, report) {
  if (!isWithin(filePath, INFRASTRUCTURE_ROOT)) {
    return;
  }

  if ([PRESENTATION_ROOT, BOOTSTRAP_ROOT].some((root) => isWithin(target, root))) {
    report('Infrastructure imports an outer layer', filePath, target);
  }
}

function refuseWideExtensionEntry(filePath, importPath, _statement, report) {
  if (filePath !== EXTENSION_ENTRY || importPath === 'vscode') {
    return;
  }

  if (!importPath.startsWith('./bootstrap/')) {
    report(`extension.ts imports outside bootstrap (${importPath})`, filePath);
  }
}

runArchitectureCheck('Extension', SOURCE_ROOT, {
  rules: [refuseInfrastructureReachingOutward],
  importRules: [refuseWideExtensionEntry, requireAliasForEscapingImport(SOURCE_ROOT, '@/')],
  aliases: { '@/': '@/' },
});
