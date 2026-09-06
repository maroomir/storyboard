import { describe, expect, it } from 'vitest';

import {
  mergeStoryboardGitignore,
  readMissingGitignoreEntries,
  storyboardGitignoreEntries,
} from '@storyboard/story-format';

describe('mergeStoryboardGitignore', () => {
  it('writes the whole block into a missing file', () => {
    const merged = mergeStoryboardGitignore(undefined);

    expect(merged).toContain('# Storyboard generated files\n');
    for (const entry of storyboardGitignoreEntries) {
      expect(merged).toContain(`${entry}\n`);
    }
    expect(merged?.startsWith('#')).toBe(true);
  });

  it("appends the marked block after a user's own entries", () => {
    const merged = mergeStoryboardGitignore('node_modules/');

    expect(merged).toBe(
      `node_modules/\n\n# Storyboard generated files\n${storyboardGitignoreEntries.join('\n')}\n`,
    );
  });

  // 0.8 이전 워크스페이스는 마커만 있고 manuscript/ 가 없다.
  it('tops up only the missing entries when the marker is already there', () => {
    const stale = '# Storyboard generated files\n.storyboard/cache/\n.draft/\n';

    const merged = mergeStoryboardGitignore(stale);

    expect(merged).toBe(
      `${stale}manuscript/\ncharacter/.sample.card\nbackground/.sample.card\nscene/.sample.card\n`,
    );
    expect(merged?.match(/# Storyboard generated files/g)).toHaveLength(1);
  });

  it('leaves a complete file alone', () => {
    const complete = mergeStoryboardGitignore(undefined) ?? '';

    expect(mergeStoryboardGitignore(complete)).toBeUndefined();
    expect(readMissingGitignoreEntries(complete)).toEqual([]);
  });
});
