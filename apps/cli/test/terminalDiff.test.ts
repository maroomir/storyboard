import { describe, expect, it } from 'vitest';

import { commandCatalog } from '../src/commands/catalog';
import { diffSentences, renderSentenceDiff, splitSentences } from '../src/terminal/diff';
import { createTheme } from '../src/terminal/theme';

describe('sentence diff', () => {
  it('splits Korean prose at sentence ends, quotes and line breaks', () => {
    expect(splitSentences('그는 화가 났다. "가자!" 그녀가 말했다.\n\n다음 문단')).toEqual([
      '그는 화가 났다.',
      '"가자!"',
      '그녀가 말했다.',
      '다음 문단',
    ]);
  });

  it('shows the changed sentence with one sentence of context and folds the rest', () => {
    const before = '하나. 둘. 셋. 그는 화가 났다. 다섯. 여섯. 일곱.';
    const after = '하나. 둘. 셋. 그는 잔을 내려놓았다. 다섯. 여섯. 일곱.';

    expect(diffSentences(before, after)).toEqual([
      { kind: 'gap', count: 2 },
      { kind: 'same', text: '셋.' },
      { kind: 'removed', text: '그는 화가 났다.' },
      { kind: 'added', text: '그는 잔을 내려놓았다.' },
      { kind: 'same', text: '다섯.' },
      { kind: 'gap', count: 2 },
    ]);
  });

  it('heads the view with the file and the counts', () => {
    const lines = renderSentenceDiff(
      'draft/01-a.md',
      diffSentences('가. 나.', '가. 다. 라.'),
      createTheme(false),
    );

    expect(lines[0]).toBe('draft/01-a.md  +2 -1');
    expect(lines).toContain('+ 다.');
    expect(lines).toContain('- 나.');
  });

  it('cuts a long diff at the limit and says how much is left', () => {
    const after = Array.from({ length: 60 }, (_, index) => `문장 ${index}.`).join(' ');
    const lines = renderSentenceDiff(
      'draft/01-a.md',
      diffSentences('', after),
      createTheme(false),
      10,
    );

    expect(lines).toHaveLength(12);
    expect(lines.at(-1)).toBe('  … 50줄 더');
  });
});

describe('draft-rewriting verbs', () => {
  it('all take the scene stem as their first argument, which the diff reads', () => {
    const rewriting = commandCatalog.filter((spec) => spec.rewritesDraft === true);

    expect(rewriting.map((spec) => spec.verb).sort()).toEqual([
      'draft augment',
      'draft condense',
      'draft edit',
      'draft expand',
      'draft format',
      'draft revise',
    ]);
    for (const spec of rewriting) {
      expect(spec.usage.startsWith(`${spec.verb} <stem>`), spec.verb).toBe(true);
    }
  });
});
