import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// These suites shell out to real git. Without pinning the config files they read, they inherit
// whatever identity the host happens to have configured — passing on a maintainer's machine and
// failing on one (a CI runner, a fresh laptop) that has none.
const configRoot = mkdtempSync(join(tmpdir(), 'storygram-gitconfig-'));
const globalConfigPath = join(configRoot, 'global');
const systemConfigPath = join(configRoot, 'system');

writeFileSync(
  globalConfigPath,
  ['[user]', '\tname = Storygram Test', '\temail = storygram-test@example.com', ''].join('\n'),
  'utf8',
);
writeFileSync(systemConfigPath, '', 'utf8');

process.env.GIT_CONFIG_GLOBAL = globalConfigPath;
process.env.GIT_CONFIG_SYSTEM = systemConfigPath;
