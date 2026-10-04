import { describe, expect, it } from 'vitest';

import { createWindowTitle, linkFilePaths } from '../src/terminal/signals';
import { measureWidth } from '../src/terminal/width';

const existing = new Set(['/work/draft/01-a.md', '/home/me/.storyboard/config.json']);
const isExistingPath = (path: string): boolean => existing.has(path);

describe('terminal signals', () => {
  it('links an existing absolute path and leaves its visible text alone', () => {
    const text = '초안을 썼습니다: /work/draft/01-a.md';
    const linked = linkFilePaths(text, isExistingPath);

    expect(linked).toContain('\u001b]8;;file:///work/draft/01-a.md\u0007/work/draft/01-a.md');
    expect(measureWidth(linked)).toBe(measureWidth(text));
  });

  it('leaves missing paths, relative paths and trailing punctuation outside the link', () => {
    expect(linkFilePaths('없는 /nope/file.md 와 draft/01-a.md', isExistingPath)).toBe(
      '없는 /nope/file.md 와 draft/01-a.md',
    );
    expect(linkFilePaths('설정: /home/me/.storyboard/config.json.', isExistingPath)).toMatch(
      /config\.json\u001b\]8;;\u0007\.$/,
    );
  });

  it('wraps a window title in OSC 2', () => {
    expect(createWindowTitle('Storyboard · draft generate')).toBe(
      '\u001b]2;Storyboard · draft generate\u0007',
    );
  });
});
