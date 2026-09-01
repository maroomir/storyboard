import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { allowListRule, runArchitectureCheck } from '../../../scripts/architecture/runner.mjs';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(PACKAGE_ROOT, 'src');

// What each layer may reach. `persistence` and `application` are deliberately absent: they are a
// mutually dependent pair — application declares the repository ports, persistence implements them
// — so there is no order to enforce between the two. Everything inward of them does have one.
const ALLOWED_IMPORTS = {
  shared: ['shared'],
  domain: ['domain', 'shared'],
  paths: ['paths', 'domain', 'shared'],
  ports: ['ports', 'paths', 'domain'],
  ai: ['ai', 'domain', 'shared'],
};

runArchitectureCheck('Engine', SOURCE_ROOT, {
  rules: [allowListRule(ALLOWED_IMPORTS, SOURCE_ROOT)],
});
