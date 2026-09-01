import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

import { aliasesFromTsconfig } from '../../scripts/aliases.mjs';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: aliasesFromTsconfig(path.join(packageRoot, 'tsconfig.json')),
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/helpers/gitEnv.ts'],
    // These suites shell out to real git and real provider runners rather than stubbing them, so
    // the default 5s budget is unrealistic on a loaded machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
