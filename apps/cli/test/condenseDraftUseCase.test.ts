import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CondenseDraftUseCase,
  WorkspaceInitializer,
  type AiServices,
  type HostAdapters,
} from '@storyboard/story-engine';
import { NodeUri } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

interface CondenseInput {
  readonly intent?: string;
  readonly facts?: readonly string[];
  readonly characterCards?: readonly string[];
}

let directory: string;
let condenseInputs: CondenseInput[];

const body: string = '하나는 방파제 끝에 서서 편지를 다시 펼쳤다. 바람이 종이를 흔들었다. '.repeat(
  20,
);

function createUseCase(): CondenseDraftUseCase {
  const host = {
    fileSystem: new NodeFileSystem(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn() },
    configBridge: { getMaxCompressionPercent: () => 30 },
  } as unknown as HostAdapters;
  const ai = {
    gateway: {
      createService: () => ({
        condenseDraft: async (input: CondenseInput) => {
          condenseInputs.push(input);
          return body.slice(0, Math.floor(body.length * 0.9));
        },
      }),
      getTaskProvider: () => 'mock',
    },
  } as unknown as AiServices;

  return new CondenseDraftUseCase(host, ai);
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'storyboard-condense-'));
  condenseInputs = [];
  await new WorkspaceInitializer(new NodeFileSystem()).createWorkspace({
    workspaceRoot: NodeUri.file(directory),
    name: '작품',
  });
  mkdirSync(join(directory, 'scene'), { recursive: true });
  writeFileSync(
    join(directory, 'scene', '01-pier.card'),
    ['type: scene', 'id: 01-pier', 'title: 방파제', 'summary: 하나가 편지를 다시 읽는다.', ''].join(
      '\n',
    ),
  );
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('CondenseDraftUseCase', () => {
  it('reads the scene context itself', async () => {
    const result = await createUseCase().execute({
      workspaceRoot: NodeUri.file(directory),
      sceneStem: '01-pier',
      format: 'novel',
      body,
    });

    expect(result.ok).toBe(true);
    expect(condenseInputs[0]?.facts).toBeDefined();
    expect(condenseInputs[0]?.characterCards).toBeDefined();
  });
});
