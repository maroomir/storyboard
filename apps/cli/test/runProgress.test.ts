import { describe, expect, it } from 'vitest';

import { LiveArea } from '../src/adapters/liveArea';
import {
  describeChecklist,
  formatElapsed,
  LineRunProgress,
  RailRunProgress,
} from '../src/adapters/runProgress';
import { createTheme } from '../src/terminal/theme';

function recordingStream(): { written: string[]; write: (text: string) => void } {
  const written: string[] = [];
  return { written, write: (text) => written.push(text) };
}

describe('live area', () => {
  it('erases the drawn lines before writing above them and draws them again after', () => {
    const stream = recordingStream();
    const area = new LiveArea(stream, () => 80);

    area.show(['진행 1', '진행 2']);
    area.writeAbove('[warn] 경고\n');
    area.clear();

    expect(stream.written).toEqual([
      '진행 1\n진행 2\n',
      '\r\u001b[2A\u001b[0J',
      '[warn] 경고\n',
      '진행 1\n진행 2\n',
      '\r\u001b[2A\u001b[0J',
    ]);
  });

  it('cuts a line that would wrap, so the erase stays exact', () => {
    const stream = recordingStream();
    new LiveArea(stream, () => 10).show(['씬 012-ambush 살붙임']);

    expect(stream.written[0]?.endsWith('…\n')).toBe(true);
  });

  it('erases the rows a narrowed window wrapped the lines into', () => {
    const stream = recordingStream();
    let columns = 80;
    const area = new LiveArea(stream, () => columns);

    area.show(['가'.repeat(30)]);
    columns = 20;
    area.clear();

    expect(stream.written.at(-1)).toBe('\r\u001b[3A\u001b[0J');
  });
});

describe('run progress', () => {
  it('logs the same line a pipe has always had', () => {
    const logged: string[] = [];
    const progress = new LineRunProgress({
      info: (message) => logged.push(message),
      warn: () => undefined,
      error: () => undefined,
      show: () => undefined,
    });

    progress.update({ line: '3/32 03-gate', unit: { current: 3, total: 32, label: '03-gate' } });
    expect(logged).toEqual(['3/32 03-gate']);
  });

  it('draws the scene, its stage, time, cost and a bar on the rail', () => {
    let clock = 0;
    const rail = new RailRunProgress({
      liveArea: new LiveArea(recordingStream(), () => 80),
      theme: createTheme(false),
      readCostUsd: () => 0.18,
      now: () => clock,
    });

    rail.update({
      line: '12/32 012-ambush',
      unit: { current: 12, total: 32, label: '012-ambush' },
    });
    clock = 102_000;
    rail.update({ line: '살붙임 3/5', step: '살붙임 3/5' });
    const [status, bar] = rail.describeLines();
    rail.finish();

    expect(status).toMatch(/^. 문장을 고르는 중… 12\/32 012-ambush · 살붙임 3\/5 {2}01:42 · \$0\.18$/);
    expect(bar).toBe(`  ${'█'.repeat(7)}${'░'.repeat(13)}`);
  });

  it('formats elapsed time as minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(3_725_000)).toBe('62:05');
  });

  it('checks done stages, marks the running one and dims the rest', () => {
    const checklist = {
      labels: ['아웃라인', '씬 시드', '장별 초안·검수', '원고 조립'],
      currentIndex: 2,
    };

    expect(describeChecklist(checklist, createTheme(false))).toBe(
      '✓ 아웃라인  ✓ 씬 시드  › 장별 초안·검수  · 원고 조립',
    );
  });

  it('shows tokens in place of dollars for a run that has no price', () => {
    const rail = new RailRunProgress({
      liveArea: new LiveArea(recordingStream(), () => 80),
      theme: createTheme(false),
      readCostUsd: () => 0,
      readUnpricedTokens: () => 12_345,
      now: () => 0,
    });

    rail.update({ line: 'draft: 뼈대', step: '뼈대' });
    const lines = rail.describeLines();
    rail.finish();

    expect(lines[0]).toMatch(/00:00 · 12,345 토큰$/);
    expect(lines[0]).not.toContain('$');
  });

  it('adds the checklist under the status line of a staged run', () => {
    const rail = new RailRunProgress({
      liveArea: new LiveArea(recordingStream(), () => 80),
      theme: createTheme(false),
      readCostUsd: () => 0,
      now: () => 0,
    });

    rail.update({
      line: 'seeds: 씬 시드를 만드는 중',
      step: '씬 시드를 만드는 중',
      checklist: { labels: ['아웃라인', '씬 시드'], currentIndex: 1 },
    });
    const lines = rail.describeLines();
    rail.finish();

    expect(lines[0]).toMatch(/^. 구상하는 중… 씬 시드를 만드는 중 {2}00:00$/);
    expect(lines[1]).toBe('  ✓ 아웃라인  › 씬 시드');
  });
});
