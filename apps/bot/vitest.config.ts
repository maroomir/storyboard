import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@storyboard/story-format': path.join(
        packageRoot,
        '../../packages/story-format/src/index.ts',
      ),
      '@storyboard/story-git': path.join(packageRoot, '../../packages/story-git/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
