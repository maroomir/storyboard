import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ConfigBridgeDependencies, SceneGenerationTuningLike, UsageRecord } from '@storyboard/story-ai';
import { ConfigBridge } from '@storyboard/story-ai';

import type { ParsedArguments } from '../src/cliArguments';
import { commands } from '../src/commands/index';
import { createCliContainer, type CliContainerOptions } from '../src/container';

// 측정 하니스가 기대는 컨테이너 이음매 셋을 실제 생성으로 확인한다. mock 프로바이더가 프롬프트를
// 되울려 주므로, 손잡이가 파이프라인에 닿았는지를 초안 본문으로 볼 수 있다.

let home: string;
let workspace: string;
let previousHome: string | undefined;

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

function args(path: string[], flags: Record<string, string | boolean>, positionals: string[] = []): ParsedArguments {
  return { path, flags, positionals };
}

function containerWith(overrides: Partial<CliContainerOptions> = {}) {
  return createCliContainer({
    workspacePath: workspace,
    logger: silentLogger,
    canPrompt: false,
    version: '0.0.0',
    ...overrides,
  });
}

async function generateScene(overrides: Partial<CliContainerOptions> = {}) {
  return await commands['scene generate']({
    container: containerWith(overrides),
    args: args(['scene', 'generate'], { force: true }, ['01-opening']),
  });
}

function draftBody(): string {
  return readFileSync(join(workspace, 'draft', '01-opening.md'), 'utf8');
}

beforeEach(async () => {
  previousHome = process.env.STORYBOARD_HOME;
  home = mkdtempSync(join(tmpdir(), 'storyboard-sim-home-'));
  process.env.STORYBOARD_HOME = home;
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-sim-ws-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));

  await commands['init']({
    container: containerWith(),
    args: args(['init'], { title: '시그널' }),
  });

  mkdirSync(join(workspace, 'character'), { recursive: true });
  mkdirSync(join(workspace, 'background'), { recursive: true });
  mkdirSync(join(workspace, 'scene'), { recursive: true });
  writeFileSync(
    join(workspace, 'character', 'elia.card'),
    'type: character\nid: elia\nname: 엘리아\nrole: main\n',
  );
  writeFileSync(
    join(workspace, 'background', 'gate.card'),
    'type: location\nid: gate\nname: 학교 정문\nlocationKind: place\ndescription:\n  - 아침의 교문.\n',
  );
  writeFileSync(
    join(workspace, 'scene', '01-opening.card'),
    'type: scene\nid: 01-opening\ntitle: 시작\ncharacters:\n  - elia\nlocation: gate\nsummary: 엘리아가 문을 열고 들어온다. 비가 내린다.\n',
  );
});

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.STORYBOARD_HOME;
  } else {
    process.env.STORYBOARD_HOME = previousHome;
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('usage sink seam', () => {
  // 구독형 CLI를 쓰면 비용 축의 유일한 재료가 이 원장이다. 한 호출이라도 새면 값이 조용히 낮아진다.
  it('records every provider call, and every record carries attribution', async () => {
    const records: UsageRecord[] = [];
    const outcome = await generateScene({
      usageSink: {
        record: async (_root, usage): Promise<void> => {
          records.push(usage);
        },
      },
    });

    expect(outcome.ok).toBe(true);

    // 페르소나와 배경 묘사는 귀속이 없으면 이벤트 자체가 안 나간다. 둘이 보이는 것이 곧 실증이다.
    const tasks = new Set(records.map((record) => record.taskName));
    expect(tasks).toContain('personaGeneration');
    expect(tasks).toContain('backgroundDescription');
    expect(tasks).toContain('sceneSkeleton');
    expect(tasks).toContain('sceneSectionExpansion');

    expect(records.filter((record) => record.attribution.primary === undefined)).toEqual([]);
  });

  it('keeps the no-op sink when no ledger is supplied', async () => {
    await expect(generateScene()).resolves.toMatchObject({ ok: true });
  });
});

describe('config bridge seam', () => {
  class TunedConfigBridge extends ConfigBridge {
    public constructor(
      dependencies: ConfigBridgeDependencies,
      private readonly overrides: SceneGenerationTuningLike,
    ) {
      super(dependencies);
    }

    public override getSceneGenerationTuning(): SceneGenerationTuningLike {
      return { ...super.getSceneGenerationTuning(), ...this.overrides };
    }
  }

  // mock 은 받은 프롬프트를 되울리므로, 뼈대 목표 분량이 바뀌면 초안 본문이 바뀐다. 손잡이가
  // 파이프라인까지 실제로 닿았다는 증거다.
  it('layers a tuning override onto the pipeline', async () => {
    await generateScene({
      createConfigBridge: (dependencies) => new TunedConfigBridge(dependencies, { skeletonRatio: 0.2 }),
    });
    const thin = draftBody();

    await generateScene({
      createConfigBridge: (dependencies) => new TunedConfigBridge(dependencies, { skeletonRatio: 0.9 }),
    });

    expect(draftBody()).not.toBe(thin);
  });

  it('falls back to the plain bridge when no factory is given', async () => {
    await expect(generateScene()).resolves.toMatchObject({ ok: true });
  });
});

describe('fixture mutation', () => {
  function textOf(relativePath: string): string {
    return readFileSync(join(workspace, relativePath), 'utf8');
  }

  // 인물·배경 카드는 생성이 건드리지 않는다. 후처리를 끈 실행이 이 둘을 바꾸면 시험체가 회차마다
  // 달라진 것이므로, 그때는 측정값을 버려야 한다.
  it('leaves the character and background cards byte-identical', async () => {
    const before = ['character/elia.card', 'background/gate.card'].map(textOf);

    await generateScene({ postGenerationUpdates: false });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(['character/elia.card', 'background/gate.card'].map(textOf)).toEqual(before);
  });

  // NOTE: 씬 카드는 다르다 — grounding 과 beats 가 생성 중에 카드로 되쓰인다. 그래서 1회차가
  // 2회차의 입력을 바꾼다. 측정 실행이 트랙 원본을 그대로 쓰면 기록한 트랙 해시가 실제 입력을
  // 설명하지 못하므로, 시뮬레이터는 반드시 회차마다 스크래치 사본에서 돌아야 한다.
  it('rewrites the scene card, which is why a run needs a scratch copy', async () => {
    const before = textOf('scene/01-opening.card');

    await generateScene({ postGenerationUpdates: false });

    expect(textOf('scene/01-opening.card')).not.toBe(before);
    expect(textOf('scene/01-opening.card')).toContain('beats:');
  });
});
