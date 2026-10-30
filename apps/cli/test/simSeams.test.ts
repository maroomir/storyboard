import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ConfigBridgeDependencies } from '@storyboard/story-ai';
import type { GenerationKnobs, UsageRecord } from '@storyboard/story-model';
import { ConfigBridge } from '@storyboard/story-ai';

import type { ParsedArguments } from '@/cliArguments';
import { commands, findCommand } from '@/commands/index';
import { createCliContainer, type CliContainerOptions } from '@/container';

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
  return await findCommand('draft generate')!.execute({
    container: containerWith(overrides),
    args: args(['draft', 'generate'], { force: true }, ['01-opening']),
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

  await findCommand('init')!.execute({
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
      private readonly overrides: GenerationKnobs,
    ) {
      super(dependencies);
    }

    public override getSceneGenerationTuning(): GenerationKnobs {
      return { ...super.getSceneGenerationTuning(), ...this.overrides };
    }
  }

  it('layers a tuning override onto the pipeline', async () => {
    await generateScene({
      createConfigBridge: (dependencies) => new TunedConfigBridge(dependencies, { 'generation.skeleton.lengthRatio': 0.2 }),
    });
    const thin = draftBody();

    await generateScene({
      createConfigBridge: (dependencies) => new TunedConfigBridge(dependencies, { 'generation.skeleton.lengthRatio': 0.9 }),
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

  it('leaves the character and background cards byte-identical', async () => {
    const before = ['character/elia.card', 'background/gate.card'].map(textOf);

    await generateScene({ postGenerationUpdates: false });
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(['character/elia.card', 'background/gate.card'].map(textOf)).toEqual(before);
  });

  it('rewrites the scene card, which is why a run needs a scratch copy', async () => {
    const before = textOf('scene/01-opening.card');

    await generateScene({ postGenerationUpdates: false });

    expect(textOf('scene/01-opening.card')).not.toBe(before);
    expect(textOf('scene/01-opening.card')).toContain('beats:');
  });
});
