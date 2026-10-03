import { describe, expect, it } from 'vitest';

import { getStoryboardProjectPaths, NodeUri, parseScene } from '@storyboard/story-model';
import { resolveSceneThread } from '@storyboard/story-engine';
import type { SceneFile, StoryboardProject, StoryUri } from '@storyboard/story-model';

const paths = getStoryboardProjectPaths(NodeUri.file('/w'));

const sceneFiles: Record<string, string> = {
  '01-dock.card': 'type: scene\nid: 01-dock\nthread: ep1\nsummary: 나룻배가 떠난다.\n',
  '02-alley.card': 'type: scene\nid: 02-alley\nthread: ep2\nsummary: 등불이 흔들린다.\n',
  '03-ferry.card': 'type: scene\nid: 03-ferry\nthread: ep1\nsummary: 나룻배가 돌아온다.\n',
  '04-lantern.card': 'type: scene\nid: 04-lantern\nthread: ep2\nsummary: 등불이 꺼진다.\n',
};

const fileSystem = {
  readDirectory: async (): Promise<[string, { type: 'file' | 'directory' }][]> =>
    Object.keys(sceneFiles).map((name) => [name, { type: 'file' as const }]),
  readFile: async (uri: StoryUri): Promise<Uint8Array> => {
    const name = uri.path.split('/').pop() ?? '';
    const content = sceneFiles[name];

    if (content === undefined) {
      throw new Error(`missing ${name}`);
    }

    return new TextEncoder().encode(content);
  },
} as unknown as Parameters<typeof resolveSceneThread>[3];

function projectWith(threads: StoryboardProject['setting'] extends undefined ? never : object): StoryboardProject {
  return {
    version: '1.0.0',
    id: 'p',
    name: 'p',
    format: 'novel',
    language: 'ko',
    createdAt: '2026-09-07T00:00:00.000Z',
    editor: { scenePrefixDigits: 2 },
    setting: { tags: [], prohibitions: [], styleConstraints: [], qualityCriteria: [], ...threads },
  };
}

function sceneOf(fileName: string): SceneFile {
  return parseScene(sceneFiles[fileName] as string, fileName);
}

const threadedProject = projectWith({ threads: { ep1: { title: '나룻배' }, ep2: { title: '등불' } } });

describe('resolveSceneThread', () => {
  it('leaves a project without declared threads on the default paths', async () => {
    const resolved = await resolveSceneThread(
      paths,
      sceneOf('04-lantern.card'),
      projectWith({}),
      fileSystem,
    );

    expect(resolved.threadId).toBe('main');
    expect(resolved.threadPaths.storyState).toBe(paths.storyState);
    expect(resolved.previousSceneOrder).toBeUndefined();
  });

  it('scopes the continuity paths to the scene thread', async () => {
    const resolved = await resolveSceneThread(
      paths,
      sceneOf('04-lantern.card'),
      threadedProject,
      fileSystem,
    );

    expect(resolved.threadId).toBe('ep2');
    expect(resolved.threadPaths.storyState.path).toContain('memory/threads/ep2/storyState.md');
    expect(resolved.threadPaths.chapterSummaries.path).toContain('memory/threads/ep2/summaries.md');
    expect(resolved.threadPaths.personaMemoryDirectory.path).toContain('threads/ep2/personas');
  });

  it('skips over scenes belonging to another thread when finding the previous scene', async () => {
    const resolved = await resolveSceneThread(
      paths,
      sceneOf('04-lantern.card'),
      threadedProject,
      fileSystem,
    );

    expect(resolved.previousSceneOrder).toBe(2);
  });

  it('reports no previous scene for the first scene of a thread', async () => {
    const resolved = await resolveSceneThread(
      paths,
      sceneOf('02-alley.card'),
      threadedProject,
      fileSystem,
    );

    expect(resolved.previousSceneOrder).toBeUndefined();
  });

  it('keeps the shared canon path outside the thread scope', async () => {
    const resolved = await resolveSceneThread(
      paths,
      sceneOf('04-lantern.card'),
      threadedProject,
      fileSystem,
    );

    expect(resolved.threadPaths.bibleCanon).toBe(paths.bibleCanon);
    expect(resolved.threadPaths.draftDirectory).toBe(paths.draftDirectory);
  });
});

describe('chapter defaults', () => {
  it('takes the thread from the chapter when the scene card names none', async () => {
    const planFileSystem = {
      readDirectory: async (): Promise<[string, { type: 'file' | 'directory' }][]> => [
        ['01-dock.card', { type: 'file' as const }],
        ['02-alley.card', { type: 'file' as const }],
      ],
      readFile: async (uri: StoryUri): Promise<Uint8Array> => {
        const name = uri.path.split('/').pop() ?? '';
        const bodies: Record<string, string> = {
          '01-dock.card': 'type: scene\nid: 01-dock\nsummary: 나룻배.\n',
          '02-alley.card': 'type: scene\nid: 02-alley\nsummary: 골목.\n',
        };
        const body = bodies[name];

        if (body === undefined) {
          throw new Error(`missing ${name}`);
        }

        return new TextEncoder().encode(body);
      },
    } as unknown as Parameters<typeof resolveSceneThread>[3];

    const scene = parseScene('type: scene\nid: 02-alley\nsummary: 골목.\n', '02-alley.card');
    const resolved = await resolveSceneThread(paths, scene, threadedProject, planFileSystem, 'ep1');

    expect(resolved.threadId).toBe('ep1');
    expect(resolved.previousSceneOrder).toBe(1);
  });
});
