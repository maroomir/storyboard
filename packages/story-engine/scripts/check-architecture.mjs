import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  allowListRule,
  requireAliasForEscapingImport,
  runArchitectureCheck,
} from '../../../scripts/architecture/runner.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');

// What each layer may reach. `persistence` and `application` are deliberately absent: they are a
// mutually dependent pair — application declares the repository ports, persistence implements them
// — so there is no order to enforce between the two. Everything inward of them does have one.
const ALLOWED_IMPORTS = {
  ports: ['ports'],
  ai: ['ai'],
};

runArchitectureCheck('Engine', SOURCE_ROOT, {
  rules: [allowListRule(ALLOWED_IMPORTS, SOURCE_ROOT)],
  importRules: [requireAliasForEscapingImport(SOURCE_ROOT, '#engine/')],
  aliases: { '#engine/': '#engine/' },
});
