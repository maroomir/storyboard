import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ParsedArguments } from '../src/cliArguments';
import { commands } from '../src/commands/index';
import { createCliContainer } from '../src/container';

// 이 동사들이 돈을 쓰기 전에 멈추는지를 본다. 여기서 새면 잘못된 조건으로 몇 시간이 돈다.

let home: string;
let track: string;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

function args(path: string[], flags: Record<string, string | boolean> = {}): ParsedArguments {
  return { path, flags, positionals: [] };
}

async function run(verb: string, flags: Record<string, string | boolean>) {
  return await commands[verb]?.({
    container: createCliContainer({
      workspacePath: track,
      logger: silentLogger,
      canPrompt: false,
      version: '9.9.9',
    }),
    args: args(verb.split(' '), flags),
  });
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sim-cmd-home-'));
  process.env.STORYBOARD_HOME = home;
  writeFileSync(join(home, 'config.json'), JSON.stringify({ defaultProvider: 'claude' }));

  track = mkdtempSync(join(tmpdir(), 'sim-cmd-track-'));
  const genre = join(track, 'track', 'chain', 'thriller');
  mkdirSync(join(genre, 'scene'), { recursive: true });
  mkdirSync(join(genre, 'floor'), { recursive: true });
  writeFileSync(
    join(genre, 'scene', '01-a.card'),
    'type: scene\nid: 01-a\ntitle: 첫 씬\ntargetWordCount: 3000\nsummary: 문을 연다.\n',
  );
  writeFileSync(join(genre, 'floor', '01-a.md'), '망가진 원고');
});

afterEach(() => {
  delete process.env.STORYBOARD_HOME;
  rmSync(home, { recursive: true, force: true });
  rmSync(track, { recursive: true, force: true });
});

describe('sim run', () => {
  it('refuses without a track', async () => {
    expect(await run('sim run', {})).toMatchObject({ ok: false });
  });

  // 견적을 보여 주고 멈춘다. --yes 가 없으면 한 호출도 하지 않는다.
  it('prints the estimate and stops', async () => {
    const outcome = await run('sim run', { track, genre: 'thriller' });

    expect(outcome?.ok).toBe(true);
    expect(outcome?.message).toContain('--yes');
    expect(outcome?.message).toContain('예상 비용');
  });

  it('refuses an overlay knob the registry does not know', async () => {
    const overlay = join(home, 'overlay.json');
    writeFileSync(overlay, JSON.stringify({ knobs: { 'skeleton.nope': 1 } }));

    const outcome = await run('sim run', { track, genre: 'thriller', overlay });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('모르는 손잡이');
  });
});

describe('track reading', () => {
  // 목표 분량은 카드가 갖는다. 없으면 도달률의 분모가 없으므로 시작하지 않는다.
  it('refuses a scene card that carries no target length', async () => {
    writeFileSync(
      join(track, 'track', 'chain', 'thriller', 'scene', '02-b.card'),
      'type: scene\nid: 02-b\ntitle: 둘\nsummary: 비가 온다.\n',
    );

    await expect(run('sim run', { track, genre: 'thriller' })).rejects.toThrow(/targetWordCount/);
  });

  // 하한선 관문이 없으면 심판이 쓰레기를 거르는지 알 수 없다. 돈을 쓰기 전에 막는다.
  it('refuses to judge a genre that has no corrupted draft', async () => {
    rmSync(join(track, 'track', 'chain', 'thriller', 'floor'), { recursive: true, force: true });

    const outcome = await run('sim sweep', {
      track,
      genre: 'thriller',
      knobs: 'skeleton.lengthRatio,section.retryLimit,dialogue.preservedRatio,padding.paragraphRatio',
      judge: 'openai',
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('훼손 원고');
  });
});

describe('axis track', () => {
  function axisFixture(withFloors: boolean): void {
    const axis = join(track, 'track', 'axis');
    mkdirSync(join(axis, 'scene'), { recursive: true });
    mkdirSync(join(axis, 'floor'), { recursive: true });
    writeFileSync(
      join(axis, 'scene', '01-baseline.card'),
      'type: scene\nid: 01-baseline\ntitle: 표지\npurpose: 기준선\ntargetWordCount: 3000\nsummary: 문을 연다.\n',
    );
    if (withFloors) {
      writeFileSync(join(axis, 'floor', '01-baseline.md'), '망가진 원고');
    }
  }

  it('reaches track/axis through --genre axis', async () => {
    axisFixture(true);

    const outcome = await run('sim run', { track, genre: 'axis' });

    expect(outcome?.ok).toBe(true);
    expect(outcome?.message).toContain('--yes');
  });

  // 축 트랙은 씬마다 훼손본이 있어야 씬마다 눈금을 확인할 수 있다.
  it('refuses to judge the axis track when a scene has no corrupted draft', async () => {
    axisFixture(false);

    const outcome = await run('sim run', { track, genre: 'axis', judge: 'openai' });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('씬마다 훼손 원고');
  });
});

describe('sim sweep', () => {
  it('refuses a grid that is not four knobs wide', async () => {
    const outcome = await run('sim sweep', {
      track,
      genre: 'thriller',
      knobs: 'skeleton.lengthRatio,section.retryLimit',
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('넷');
  });

  const fourKnobs =
    'skeleton.lengthRatio,section.retryLimit,dialogue.preservedRatio,padding.paragraphRatio';

  it('refuses without a judge', async () => {
    const outcome = await run('sim sweep', { track, genre: 'thriller', knobs: fourKnobs });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('--judge');
  });

  // 심판이 생성과 같은 가중치면 그 지점만 점수가 들뜬다. --judge claude 는 모델을 안 주면
  // 카탈로그 첫 모델로 떨어지고, 그것이 곧 생성 모델이다.
  it('refuses a judge that lands on the generation model', async () => {
    const outcome = await run('sim sweep', {
      track,
      genre: 'thriller',
      knobs: fourKnobs,
      judge: 'claude',
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('같은 모델');
  });

  it('accepts a different model on the same provider', async () => {
    const outcome = await run('sim sweep', {
      track,
      genre: 'thriller',
      knobs: fourKnobs,
      judge: 'claude',
      'judge-model': 'claude-haiku-4-5',
    });

    expect(outcome?.ok).toBe(true);
  });

  it('reaches the estimate once the judge sits elsewhere', async () => {
    const outcome = await run('sim sweep', {
      track,
      genre: 'thriller',
      knobs: fourKnobs,
      judge: 'openai',
    });

    expect(outcome?.ok).toBe(true);
    expect(outcome?.message).toContain('지점 9');
  });

  it('refuses when the grid would exceed the run cap', async () => {
    const outcome = await run('sim sweep', {
      track,
      genre: 'thriller',
      knobs: fourKnobs,
      judge: 'openai',
      'max-runs': '5',
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('max-runs');
  });
});

describe('sim report', () => {
  it('says so plainly when nothing has been recorded', async () => {
    const outcome = await run('sim report', { out: join(home, 'runs.jsonl') });

    expect(outcome?.ok).toBe(true);
    expect(outcome?.message).toContain('아직');
  });

  it('marks the frontier and admits there is no ceiling yet', async () => {
    const out = join(home, 'runs.jsonl');
    const base = {
      genre: 'thriller',
      engineCommit: '9.9.9',
      trackCommit: 'abc',
      trackDirty: false,
      knobs: {},
      generation: { providerId: 'claude', model: 'claude-sonnet-5' },
      scenes: [],
      tokens: { calls: 0, inputTokens: 100, outputTokens: 0, cacheReadInputTokens: 0, byTask: {}, costUsd: 0, unpricedCallCount: 0, unattributedCallCount: 0 },
      startedAt: '2026-09-13T00:00:00.000Z',
      wallClockMs: 1,
    };
    writeFileSync(
      out,
      [
        JSON.stringify({ ...base, runId: 'a', pointLabel: 'cheap', repeat: 1, auc: 0.5 }),
        JSON.stringify({ ...base, runId: 'b', pointLabel: 'rich', repeat: 1, auc: 0.9, tokens: { ...base.tokens, inputTokens: 900 } }),
      ].join('\n') + '\n',
    );

    const outcome = await run('sim report', { out });

    expect(outcome?.message).toContain('ceiling: n/a');
    expect(outcome?.message).toContain('[thriller]');
    expect(outcome?.message).toContain('* cheap');
    expect(outcome?.message).toContain('* rich');
  });
});

describe('sim apply', () => {
  it('refuses a point with no runs', async () => {
    const out = join(home, 'runs.jsonl');
    writeFileSync(out, '');

    const outcome = await run('sim apply', { out, point: 'grid:0000' });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('실행 기록이 없습니다');
  });

  // 씨앗이 없어 한 회차의 값은 잡음과 구분되지 않는다.
  it('refuses a point that was only run once', async () => {
    const out = join(home, 'runs.jsonl');
    writeFileSync(
      out,
      JSON.stringify({
        runId: 'a',
        genre: 'thriller',
        pointLabel: 'grid:0000',
        repeat: 1,
        engineCommit: '9.9.9',
        trackCommit: 'abc',
        trackDirty: false,
        knobs: { 'skeleton.lengthRatio': 0.8 },
        generation: { providerId: 'claude', model: 'claude-sonnet-5' },
        scenes: [],
        tokens: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, byTask: {}, costUsd: 0, unpricedCallCount: 0, unattributedCallCount: 0 },
        startedAt: '2026-09-13T00:00:00.000Z',
        wallClockMs: 1,
      }) + '\n',
    );

    const outcome = await run('sim apply', { out, point: 'grid:0000' });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toContain('중앙값');
  });
});
