import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ContinuityIssueLike, DraftCritiqueIssue, StyleDirective } from '@storyboard/story-ai';
import {
  createDraft,
  NodeUri,
  serializeDraft,
  serializeStoryState,
  type StoryState,
  type StoryUri,
} from '@storyboard/story-model';

const checkContinuityMock = vi.fn(
  async (body: string, factLines: readonly string[]): Promise<ContinuityIssueLike[]> => {
    void body;
    void factLines;
    return [];
  },
);
const critiqueDraftMock = vi.fn(async (input: unknown): Promise<DraftCritiqueIssue[]> => {
  void input;
  return [];
});

vi.mock('@storyboard/story-ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@storyboard/story-ai')>()),
  StoryboardAiService: class {
    checkContinuity = (
      body: string,
      factLines: readonly string[],
    ): Promise<ContinuityIssueLike[]> => checkContinuityMock(body, factLines);
    critiqueDraft = (input: unknown): Promise<DraftCritiqueIssue[]> => critiqueDraftMock(input);
    reviseDraft = async (): Promise<string> => '';
  },
}));

import {
  getStoryboardProjectPaths,
  ReviseDraftUseCase,
  type IFileSystem,
} from '@storyboard/story-engine';

class InMemoryFileSystem implements IFileSystem {
  private readonly files = new Map<string, Uint8Array>();

  public put(path: string, content: string): void {
    this.files.set(path, new TextEncoder().encode(content));
  }

  public async readFile(uri: StoryUri): Promise<Uint8Array> {
    const content = this.files.get(uri.path);

    if (!content) {
      throw new Error(`File not found: ${uri.path}`);
    }

    return content;
  }

  public async writeFile(uri: StoryUri, content: Uint8Array): Promise<void> {
    this.files.set(uri.path, content);
  }

  public async createDirectory(): Promise<void> {
    return undefined;
  }

  public async exists(uri: StoryUri): Promise<boolean> {
    return this.files.has(uri.path);
  }

  public async listFileNames(uri: StoryUri): Promise<readonly string[]> {
    return (await this.readDirectory(uri)).map(([name]) => name);
  }

  public async readDirectory(uri: StoryUri): Promise<[string, { type: 'file' | 'directory' }][]> {
    const prefix = `${uri.path}/`;
    const names = new Set<string>();

    for (const path of this.files.keys()) {
      if (path.startsWith(prefix)) {
        const name = path.slice(prefix.length).split('/')[0];
        if (name) {
          names.add(name);
        }
      }
    }

    return [...names].map((name) => [
      name,
      { type: this.files.has(`${prefix}${name}`) ? 'file' : 'directory' },
    ]);
  }

  public async delete(uri: StoryUri): Promise<void> {
    this.files.delete(uri.path);
  }

  public async modifiedTime(): Promise<number> {
    return 0;
  }

  public async isRealPathInside(): Promise<boolean> {
    return true;
  }
}

const workspaceUri = NodeUri.file('/w');
const paths = getStoryboardProjectPaths(workspaceUri);

function storyStateWith(fact: string): string {
  const state: StoryState = {
    throughSceneOrder: 1,
    sceneInputHashes: new Map(),
    entries: [{ section: 'facts', text: fact, throughScene: 1 }],
  };

  return serializeStoryState(state);
}

function threadedWorkspace(): InMemoryFileSystem {
  const fs = new InMemoryFileSystem();

  fs.put(
    '/w/.storyboard/project.json',
    JSON.stringify({
      version: '1.0.0',
      id: 'p',
      name: 'p',
      format: 'novel',
      language: 'ko',
      createdAt: '2026-09-07T00:00:00.000Z',
      editor: { scenePrefixDigits: 2 },
      setting: {
        tags: [],
        prohibitions: [],
        styleConstraints: [],
        qualityCriteria: [],
        pov: 'third-omniscient',
        threads: { ep1: { title: '나룻배' }, ep2: { title: '등불' } },
      },
    }),
  );
  fs.put(
    '/w/scene/01-dock.card',
    'type: scene\nid: 01-dock\nthread: ep1\nsummary: 나룻배가 떠난다.\n',
  );
  fs.put(
    '/w/scene/02-alley.card',
    'type: scene\nid: 02-alley\nthread: ep2\nnarrator: hana\nsummary: 등불이 흔들린다.\n',
  );
  fs.put(
    '/w/narrator/hana.card',
    'type: narrator\nid: hana\nname: 하나\nperson: first\nknowledge: witnessed\nfocal: hana\n',
  );
  fs.put('/w/.storyboard/memory/storyState.md', storyStateWith('메인 줄기의 사실'));
  fs.put('/w/.storyboard/memory/threads/ep2/storyState.md', storyStateWith('등불 줄기의 사실'));
  fs.put(
    '/w/draft/02-alley.md',
    serializeDraft(
      createDraft({
        sceneStem: '02-alley',
        format: 'novel',
        body: '등불이 흔들렸다.',
        generator: 'test',
        providerId: 'mock',
        model: 'mock-model',
      }),
    ),
  );

  return fs;
}

async function reviseAlleyScene(fs: InMemoryFileSystem): Promise<void> {
  const useCase = new ReviseDraftUseCase({
    aiProviderRegistry: {
      getTaskProvider: () => 'mock',
      getTaskAiConfig: () => ({ providerId: 'mock', model: 'mock-model' }),
    } as never,
    usageSink: { record: async (): Promise<void> => undefined },
    fileSystem: fs,
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined } as never,
    generator: 'storyboard@0.0.0-test',
  });

  await useCase.execute({
    workspaceUri,
    paths,
    draftUri: NodeUri.file('/w/draft/02-alley.md'),
    sceneStem: '02-alley',
    maxIterations: 1,
    maxCompressionPercent: 50,
    reviseScoreThreshold: 0,
  });
}

describe('ReviseDraftUseCase thread scope', () => {
  beforeEach(() => {
    checkContinuityMock.mockClear();
    critiqueDraftMock.mockClear();
  });

  it('checks continuity against the story state of the scene thread, not the main thread', async () => {
    await reviseAlleyScene(threadedWorkspace());

    const factLines = checkContinuityMock.mock.calls[0]?.[1] ?? [];

    expect(factLines.some((line) => line.includes('등불 줄기의 사실'))).toBe(true);
    expect(factLines.some((line) => line.includes('메인 줄기의 사실'))).toBe(false);
  });

  it('critiques with the narration the scene narrator card resolves to', async () => {
    await reviseAlleyScene(threadedWorkspace());

    const input = critiqueDraftMock.mock.calls[0]?.[0] as {
      readonly styleDirective: StyleDirective | undefined;
    };

    expect(input.styleDirective?.narration).toMatchObject({
      narratorId: 'hana',
      person: 'first',
      knowledge: 'witnessed',
      focal: 'hana',
    });
  });
});
