import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@storyboard/story-engine': path.join(
        packageRoot,
        '../../packages/story-engine/src/index.ts',
      ),
      '@storyboard/story-format': path.join(
        packageRoot,
        '../../packages/story-format/src/index.ts',
      ),
      '@storyboard/story-ai': path.join(packageRoot, '../../packages/story-ai/src/index.ts'),
      '@storyboard/story-pipeline': path.join(
        packageRoot,
        '../../packages/story-pipeline/src/index.ts',
      ),
    },
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
