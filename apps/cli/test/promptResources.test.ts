import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { promptResourceKeys, promptTuningKeys } from '@storyboard/story-ai';

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

  it('names every resource after a prompt the tuning table knows', () => {
    const tuningKeys = new Set<string>(promptTuningKeys());

    for (const key of promptResourceKeys()) {
      expect(tuningKeys.has(key), key).toBe(true);
    }
  });
});
