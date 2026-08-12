import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@storyboard/story-ai': path.join(packageRoot, '../../packages/story-ai/src/index.ts'),
      '@storyboard/story-pipeline': path.join(packageRoot, '../../packages/story-pipeline/src/index.ts'),
      '@storyboard/story-git': path.join(packageRoot, '../../packages/story-git/src/index.ts'),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/helpers/gitEnv.ts', 'test/helpers/seedkernel.ts', 'test/helpers/weeding.ts'],
    // These suites shell out to real git and real provider runners rather than stubbing them, so
    // the default 5s budget is unrealistic on a loaded machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
