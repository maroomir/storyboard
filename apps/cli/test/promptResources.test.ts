import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { promptResourceKeys, promptResources } from '@storyboard/story-ai';

// @ts-expect-error -- the build script is plain JavaScript and ships no types.
import { renderPromptResourcesModule } from '../../../scripts/build-prompt-resources.mjs';

const repoRoot = join(__dirname, '..', '..', '..');

describe('prompt resources', () => {
  // The Markdown is the source; the generated module is what the apps bundle. A stale module would
  // ship yesterday's wording under today's file.
  it('keeps the generated module in step with the Markdown files', () => {
    const generated = readFileSync(
      join(repoRoot, 'packages/story-ai/src/ai/prompts/resources.generated.ts'),
      'utf8',
    );

    expect(generated).toBe(renderPromptResourcesModule());
  });

  it('carries a sampling config in every bundled resource', () => {
    for (const key of promptResourceKeys()) {
      expect(() => promptResources.config(key), key).not.toThrow();
    }
  });
});
