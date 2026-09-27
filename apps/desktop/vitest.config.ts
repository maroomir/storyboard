import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

import { aliasesFromTsconfig } from '../../scripts/aliases.mjs';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: aliasesFromTsconfig(path.join(packageRoot, 'tsconfig.json')),
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
    environmentMatchGlobs: [['test/renderer/**', 'jsdom']],
  },
});
