import { describe, expect, it } from 'vitest';

import { minimumBoxWidth, renderBox, renderColumns } from '../src/terminal/layout';
import { measureWidth, padEndToWidth, truncateToWidth, wrapToWidth } from '../src/terminal/width';

describe('terminal width', () => {
  it('counts Hangul as two columns and color codes as none', () => {
    expect(measureWidth('씬 카드')).toBe(7);
    expect(measureWidth('\u001b[36mscene\u001b[39m')).toBe(5);
    expect(measureWidth('한')).toBe(2);
  });

  it('pads by columns, not characters', () => {
    expect(measureWidth(padEndToWidth('초안', 10))).toBe(10);
    expect(padEndToWidth('초안', 10)).toBe('초안      ');
  });

  it('truncates without splitting a wide character', () => {
    const cut = truncateToWidth('장편 소설을 터미널에서', 9);

    expect(measureWidth(cut)).toBeLessThanOrEqual(9);
    expect(cut.endsWith('…')).toBe(true);
    expect(truncateToWidth('짧다', 9)).toBe('짧다');
  });

  it('wraps Korean text inside the width and breaks a word only when it must', () => {
    const lines = wrapToWidth('씬 카드의 사건 비트를 전개해 beats 필드에 씁니다', 16);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => measureWidth(line) <= 16)).toBe(true);
    expect(wrapToWidth('/a/very/long/path/without/spaces', 10).every((l) => l.length <= 10)).toBe(
      true,
    );
  });
});

describe('box', () => {
  const content = ['✔ 공통 설정   ~/.storyboard/config.json', '▲ 워크스페이스 아님', 'API key'];

  it('keeps the right edge straight when Hangul and Latin mix', () => {
    const box = renderBox(content, { availableWidth: 80, title: '환경' });
    const widths = new Set(box.map(measureWidth));

    expect(widths.size).toBe(1);
    expect(box[0]).toContain(' 환경 ');
    expect(box[0]?.startsWith('╭─')).toBe(true);
    expect(box.at(-1)?.startsWith('╰')).toBe(true);
  });

  it('wraps content that is wider than the terminal and still closes every line', () => {
    const long = [
      '설정 파일·프로바이더·API 키·CLI 실행 파일과 로그인·워크스페이스·이야기 상태 원장을 점검합니다',
    ];
    const box = renderBox(long, { availableWidth: 50 });

    expect(box.length).toBeGreaterThan(3);
    expect(box.every((line) => measureWidth(line) === measureWidth(box[0] ?? ''))).toBe(true);
    expect(measureWidth(box[0] ?? '')).toBeLessThanOrEqual(50);
  });

  it('drops the frame on a terminal too narrow for one', () => {
    const plain = renderBox(content, { availableWidth: minimumBoxWidth - 1, title: '환경' });

    expect(plain[0]).toBe('환경');
    expect(plain.join('\n')).not.toMatch(/[╭╮╰╯│]/);
  });
});

describe('columns', () => {
  const rows = [
    { label: 'scene list', description: '씬 카드 목록을 보여 줍니다' },
    {
      label: 'draft generate <stem> | --all',
      description: '씬 카드에서 초안을 생성합니다 (검수·수정 포함, --force 로 다시 생성)',
    },
  ];

  it('aligns every description at one column and hangs wrapped lines under it', () => {
    const lines = renderColumns(rows, { availableWidth: 60 });
    const start = (lines[0] ?? '').indexOf('씬');

    expect(lines.every((line) => measureWidth(line) <= 60)).toBe(true);
    expect((lines[1] ?? '').indexOf('씬')).toBe(start);
    expect(lines.slice(2).every((line) => line.startsWith(' '.repeat(start)))).toBe(true);
  });

  it('moves a description under a label that is wider than the label column', () => {
    const lines = renderColumns(
      [{ label: 'card rename <type> <id> --to <id>', description: '카드 id 를 바꿉니다' }, ...rows],
      { availableWidth: 80, maximumLabelWidth: 30 },
    );

    expect(lines[0]).toBe('  card rename <type> <id> --to <id>');
    expect(lines[1]?.trim()).toBe('카드 id 를 바꿉니다');
  });

  it('stacks label and description on a narrow terminal', () => {
    const lines = renderColumns(rows, { availableWidth: 40 });

    expect(lines[0]).toBe('  scene list');
    expect(lines[1]).toBe('    씬 카드 목록을 보여 줍니다');
    expect(lines.every((line) => measureWidth(line) <= 40)).toBe(true);
  });
});
