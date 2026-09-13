import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SceneSkeletonPrompt, type UsageRecord } from '@storyboard/story-ai';
import {
  appendRun,
  assertTrackUnchanged,
  completedKeys,
  describeEngine,
  describeTrack,
  draftsDirectoryFor,
  keepDrafts,
  listLocalModels,
  missingLocalModels,
  simResultsDirectory,
  measureScene,
  readRuns,
  runKey,
  runTrack,
  summarizeScenes,
  weighWarnings,
  type ISimWorkspaceFactory,
  type RunRecord,
  type SimSceneGenerator,
} from '@storyboard/story-sim';

// 실행기는 돈이 드는 유일한 경로지만, 무엇을 세고 무엇을 건너뛰는지는 전부 결정론적으로 잴 수 있다.

function usageRecord(): UsageRecord {
  return {
    taskName: 'sceneSkeleton',
    providerId: 'claude',
    model: 'claude-sonnet-5',
    usage: { inputTokens: 1000, outputTokens: 500 },
    attribution: { primary: { kind: 'scene', id: '01' } },
  };
}

function fakeFactory(options: {
  readonly draft?: (stem: string) => string;
  readonly fail?: ReadonlySet<string>;
  readonly onOpen?: (input: unknown) => void;
}): ISimWorkspaceFactory {
  return {
    open: async (input) => {
      options.onOpen?.(input);
      let pending: UsageRecord[] = [];

      const generator: SimSceneGenerator = {
        workspacePath: input.workspacePath,
        generate: async (stem) => {
          pending = [usageRecord()];
          return options.fail?.has(stem) === true
            ? { ok: false, kind: 'failed', message: '프로바이더 오류', warnings: [] }
            : { ok: true, kind: 'generated', warnings: ['1구간: too-short 목표에 못 미칩니다'] };
        },
        drainUsage: () => {
          const drained = pending;
          pending = [];
          return drained;
        },
        readDraft: async (stem) => options.draft?.(stem) ?? `${stem} 본문`.repeat(50),
      };

      return generator;
    },
  };
}

const scenes = [
  { sceneStem: '01-a', targetLength: 1000 },
  { sceneStem: '02-b', targetLength: 1000 },
];

describe('warning weight', () => {
  // 개수만 세면 «인물이 새로 등장» 과 «조금 짧다» 가 같은 무게가 된다.
  it('weighs a cast violation heavier than a length one', () => {
    expect(weighWarnings(['1구간: cast 뼈대에 없는 인물'])).toBeGreaterThan(
      weighWarnings(['1구간: too-short 짧습니다']),
    );
  });

  it('gives an unrecognised warning the lightest weight rather than ignoring it', () => {
    expect(weighWarnings(['알 수 없는 경고'])).toBe(1);
  });
});

describe('scene metrics', () => {
  it('computes reach against the target', () => {
    const metrics = measureScene({
      sceneStem: '01-a',
      targetLength: 1000,
      draft: '가'.repeat(640),
      warnings: [],
    });

    expect(metrics.reach).toBeCloseTo(0.64);
  });

  it('reports zero reach rather than dividing by a zero target', () => {
    expect(
      measureScene({ sceneStem: '01-a', targetLength: 0, draft: '가', warnings: [] }).reach,
    ).toBe(0);
  });

  it('averages reach over the scenes that produced a draft', () => {
    const summary = summarizeScenes([
      measureScene({ sceneStem: '01', targetLength: 100, draft: '가'.repeat(50), warnings: [] }),
      measureScene({ sceneStem: '02', targetLength: 100, draft: '가'.repeat(70), warnings: [] }),
    ]);

    expect(summary.meanReach).toBeCloseTo(0.6);
  });
});

describe('track run', () => {
  it('generates the scenes in order and collects their tokens', async () => {
    const seen: string[] = [];
    const result = await runTrack({
      factory: fakeFactory({}),
      workspacePath: '/tmp/ws',
      scenes,
      tuning: {},
      promptOverrides: {},
      onProgress: (stem) => seen.push(stem),
    });

    expect(seen).toEqual(['01-a', '02-b']);
    expect(result.tokens.calls).toBe(2);
    expect(result.drafts.size).toBe(2);
    expect(result.failures).toEqual([]);
  });

  // 생성이 실패한 씬은 원고가 없다. 그 씬을 0점으로 세면 손잡이 탓으로 읽히므로 따로 남긴다.
  it('records a failed scene instead of scoring it as a zero', async () => {
    const result = await runTrack({
      factory: fakeFactory({ fail: new Set(['02-b']) }),
      workspacePath: '/tmp/ws',
      scenes,
      tuning: {},
      promptOverrides: {},
    });

    expect(result.failures).toHaveLength(1);
    expect(result.metrics.scenes).toHaveLength(1);
    expect(result.drafts.has('02-b')).toBe(false);
  });

  it('passes the tuning through to the workspace it opens', async () => {
    const onOpen = vi.fn();

    await runTrack({
      factory: fakeFactory({ onOpen }),
      workspacePath: '/tmp/ws',
      scenes: scenes.slice(0, 1),
      tuning: { skeletonRatio: 0.8 },
      promptOverrides: {},
      sectionOutputLimit: 1000,
    });

    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ tuning: { skeletonRatio: 0.8 }, sectionOutputLimit: 1000 }),
    );
  });

  // 프롬프트 덮개는 전역이다. 실행이 끝나고 안 되돌리면 다음 지점이 앞 지점의 온도로 돌아간다.
  it('puts the prompt overrides back when the run ends', async () => {
    const before = SceneSkeletonPrompt.config.temperature;

    await runTrack({
      factory: fakeFactory({}),
      workspacePath: '/tmp/ws',
      scenes: scenes.slice(0, 1),
      tuning: {},
      promptOverrides: { sceneSkeleton: { temperature: 1.7 } },
    });

    expect(SceneSkeletonPrompt.config.temperature).toBe(before);
  });

  it('puts them back even when a scene throws', async () => {
    const before = SceneSkeletonPrompt.config.temperature;
    const exploding: ISimWorkspaceFactory = {
      open: async () => {
        throw new Error('열 수 없습니다');
      },
    };

    await expect(
      runTrack({
        factory: exploding,
        workspacePath: '/tmp/ws',
        scenes,
        tuning: {},
        promptOverrides: { sceneSkeleton: { temperature: 1.7 } },
      }),
    ).rejects.toThrow();

    expect(SceneSkeletonPrompt.config.temperature).toBe(before);
  });

  it('stops when the caller cancels', async () => {
    const result = runTrack({
      factory: fakeFactory({}),
      workspacePath: '/tmp/ws',
      scenes,
      tuning: {},
      promptOverrides: {},
      shouldCancel: () => true,
    });

    await expect(result).rejects.toThrow(/취소/);
  });
});

describe('run store', () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  function record(overrides: Partial<RunRecord> = {}): RunRecord {
    return {
      runId: 'r1',
      genre: 'thriller',
      pointLabel: 'baseline',
      repeat: 1,
      engineCommit: 'engine1',
      trackCommit: 'track1',
      trackDirty: false,
      knobs: {},
      generation: { providerId: 'claude', model: 'claude-sonnet-5' },
      scenes: [],
      tokens: {
        calls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        byTask: {},
        costUsd: 0,
        unpricedCallCount: 0,
        unattributedCallCount: 0,
      },
      startedAt: new Date().toISOString(),
      wallClockMs: 1,
      ...overrides,
    };
  }

  function file(): string {
    directory = mkdtempSync(join(tmpdir(), 'sim-runs-'));
    return join(directory, 'nested', 'runs.jsonl');
  }

  it('returns nothing for a file that does not exist yet', async () => {
    expect(await readRuns(join(tmpdir(), 'absent', 'runs.jsonl'))).toEqual([]);
  });

  it('appends one line per run and reads them all back', async () => {
    const path = file();

    await appendRun(path, record());
    await appendRun(path, record({ repeat: 2 }));

    expect(await readRuns(path)).toHaveLength(2);
  });

  // 죽는 순간 반쯤 쓰인 줄이 남는다. 그 한 줄 때문에 앞서 몇 시간 돌린 결과를 잃으면 안 된다.
  it('keeps the intact lines when the last one was cut off', async () => {
    const path = file();

    await appendRun(path, record());
    const { appendFileSync } = await import('node:fs');
    appendFileSync(path, '{"runId":"r2","pointLa');

    expect(await readRuns(path)).toHaveLength(1);
  });

  it('skips the runs already finished for this engine and track', async () => {
    const path = file();

    await appendRun(path, record({ pointLabel: 'grid:0000', repeat: 1 }));

    const done = await completedKeys(path, { engineCommit: 'engine1', trackCommit: 'track1' });

    expect(done.has(runKey('thriller', 'grid:0000', 1))).toBe(true);
    expect(done.has(runKey('thriller', 'grid:0000', 2))).toBe(false);
  });

  // 엔진이나 트랙이 바뀐 뒤의 기록은 다른 것을 잰 값이다. 이어 쓰면 서로 다른 것을 섞게 된다.
  it('does not reuse a run recorded against a different engine or track', async () => {
    const path = file();

    await appendRun(path, record({ engineCommit: 'engine0' }));
    await appendRun(path, record({ pointLabel: 'other', trackCommit: 'track0' }));

    const done = await completedKeys(path, { engineCommit: 'engine1', trackCommit: 'track1' });

    expect(done.size).toBe(0);
  });

  // 한 결과 파일에 장르를 이어 쌓는다. 장르가 열쇠에 없으면 둘째 장르가 «이미 끝남» 으로 읽힌다.
  it('does not mistake another genre at the same point for a finished run', async () => {
    const path = file();

    await appendRun(path, record({ genre: 'thriller', pointLabel: 'point', repeat: 1 }));

    const done = await completedKeys(path, { engineCommit: 'engine1', trackCommit: 'track1' });

    expect(done.has(runKey('thriller', 'point', 1))).toBe(true);
    expect(done.has(runKey('wuxia', 'point', 1))).toBe(false);
  });

  it('does not reuse a run whose track was dirty', async () => {
    const path = file();

    await appendRun(path, record({ trackDirty: true }));

    const done = await completedKeys(path, { engineCommit: 'engine1', trackCommit: 'track1' });

    expect(done.size).toBe(0);
  });
});

describe('draft store', () => {
  let directory: string | undefined;

  afterEach(() => {
    if (directory !== undefined) {
      rmSync(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  // 사본은 회차가 끝나면 지워진다. 심판이 회차를 버렸을 때 무엇을 읽고 버렸는지 되짚으려면 원고가
  // 결과 곁에 남아 있어야 한다.
  it('keeps every scene draft beside the results file and records where', async () => {
    directory = mkdtempSync(join(tmpdir(), 'sim-drafts-'));
    const outPath = join(directory, 'results', 'runs.jsonl');
    const drafts = new Map([
      ['01-demolition', '첫 원고'],
      ['05-nine', '다섯째 원고'],
    ]);

    const kept = await keepDrafts(outPath, { genre: 'thriller', pointLabel: 'point', repeat: 2 }, drafts);

    expect(kept).toBe(join('drafts', 'thriller', 'point', '2'));
    expect(readFileSync(join(directory, 'results', kept, '05-nine.md'), 'utf8')).toBe('다섯째 원고');
    expect(existsSync(join(directory, 'results', kept, '01-demolition.md'))).toBe(true);
  });

  // 격자 지점 이름에는 경로에 못 쓰는 글자가 있다.
  it('turns a point label into a path segment without losing the point', () => {
    expect(draftsDirectoryFor({ genre: 'thriller', pointLabel: 'grid:0120', repeat: 1 })).toBe(
      join('drafts', 'thriller', 'grid_0120', '1'),
    );
  });
});

describe('track fingerprint', () => {
  let root: string | undefined;

  afterEach(() => {
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  function repo(): string {
    root = mkdtempSync(join(tmpdir(), 'sim-track-'));
    const git = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root });
    };
    writeFileSync(join(root, 'card.txt'), '시험체');
    git('init', '-q');
    git('add', '-A');
    git('commit', '-qm', 'fixture');
    return root;
  }

  // 결과는 트랙 안에 쌓인다. 그것을 «시험체가 바뀌었다» 로 읽으면 첫 실행이 두 번째를 막는다.
  it('does not count the results directory as a dirty fixture', async () => {
    const track = repo();
    mkdirSync(join(track, simResultsDirectory));
    writeFileSync(join(track, simResultsDirectory, 'runs.jsonl'), '{}\n');

    const ref = await describeTrack(track);

    expect(ref.dirty).toBe(false);
    await expect(assertTrackUnchanged(ref)).resolves.toBeUndefined();
  });

  // 패키지 버전은 릴리스 사이의 빌드를 가르지 못한다. 하루 다섯 빌드가 전부 «0.9.3» 으로 남았다.
  it('names the engine by its commit when run inside a repository', async () => {
    const engine = await describeEngine(repo(), '9.9.9');

    expect(engine).toMatch(/^[0-9a-f]{40}$/);
  });

  it('marks an engine with uncommitted changes as dirty', async () => {
    const track = repo();
    writeFileSync(join(track, 'card.txt'), '바뀐 시험체');

    expect(await describeEngine(track, '9.9.9')).toMatch(/-dirty$/);
  });

  it('falls back to the version outside a repository', async () => {
    root = mkdtempSync(join(tmpdir(), 'sim-noengine-'));

    expect(await describeEngine(root, '9.9.9')).toBe('9.9.9');
  });

  it('still catches a card that changed under a run', async () => {
    const track = repo();
    const ref = await describeTrack(track);
    writeFileSync(join(track, 'card.txt'), '바뀐 시험체');

    await expect(assertTrackUnchanged(ref)).rejects.toThrow(/트랙이 바뀌었습니다/);
  });
});

describe('local model check', () => {
  // 없는 모델은 호출마다 404 다. 실행기는 씬마다 실패를 적으며 끝까지 가므로 11지점 선별이 빈 기록으로 끝난다.
  it('names the models the runtime does not have', () => {
    expect(missingLocalModels(['qwen3:14b', 'gemma3:12b'], ['qwen3:14b', 'gemma4:12b'])).toEqual([
      'gemma4:12b',
    ]);
  });

  it('treats a bare name as its latest tag', () => {
    expect(missingLocalModels(['qwen3:latest'], ['qwen3'])).toEqual([]);
  });

  it('reads the tag list from the runtime', async () => {
    const fetchImpl = (async () =>
      ({ ok: true, json: async () => ({ models: [{ name: 'qwen3:14b' }] }) }) as Response) as typeof fetch;

    expect(await listLocalModels('http://127.0.0.1:11434/', fetchImpl)).toEqual(['qwen3:14b']);
  });

  it('fails loudly when the runtime does not answer', async () => {
    const fetchImpl = (async () => ({ ok: false, status: 502 }) as Response) as typeof fetch;

    await expect(listLocalModels('http://127.0.0.1:11434', fetchImpl)).rejects.toThrow('502');
  });
});
