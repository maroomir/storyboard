import { describe, expect, it } from 'vitest';

import {
  getStoryboardProjectPaths,
  readChapterNarrationDefaults,
  resolveSceneNarration,
} from '@storyboard/story-engine';
import { NodeUri, parseScene } from '@storyboard/story-format';
import type { SceneFile, StoryboardProject, StoryUri } from '@storyboard/story-format';

const paths = getStoryboardProjectPaths(NodeUri.file('/w'));

const narratorCards: Record<string, string> = {
  'hana-first.card':
    'type: narrator\nid: hana-first\nname: 하나\nperson: first\nknowledge: witnessed\nfocal: hana\n',
  'jun-omniscient.card':
    'type: narrator\nid: jun-omniscient\nname: 준의 장\nperson: third\nknowledge: omniscient\ntense: present\n',
};

const chapterPlanYaml = [
  'version: 1.0.0',
  'acts:',
  '  - id: act1',
  '    title: 1막',
  '    chapters:',
  '      - id: ch1',
  '        title: 강가에서',
  '        narrator: hana-first',
  '        thread: ep1',
  '        scenes:',
  '          - id: s1',
  '            title: 나룻배',
  '      - id: ch2',
  '        title: 다리 위',
  '        narrator: jun-omniscient',
  '        scenes:',
  '          - id: s2',
  '            title: 등불',
  '',
].join('\n');

type NarrationFileSystem = Parameters<typeof resolveSceneNarration>[4];

function fileSystemOf(
  files: Record<string, string>,
  directories: Record<string, string[]> = {},
): NarrationFileSystem {
  return {
    readDirectory: async (uri: StoryUri): Promise<[string, { type: 'file' | 'directory' }][]> => {
      const entries = directories[uri.path];

      if (!entries) {
        throw new Error(`no directory ${uri.path}`);
      }

      return entries.map((name) => [name, { type: 'file' as const }]);
    },
    readFile: async (uri: StoryUri): Promise<Uint8Array> => {
      const content = files[uri.path];

      if (content === undefined) {
        throw new Error(`missing ${uri.path}`);
      }

      return new TextEncoder().encode(content);
    },
  } as unknown as NarrationFileSystem;
}

const workspaceFileSystem = fileSystemOf(
  {
    [paths.outlineChapters.path]: chapterPlanYaml,
    [`${paths.narratorDirectory.path}/hana-first.card`]: narratorCards['hana-first.card'] as string,
    [`${paths.narratorDirectory.path}/jun-omniscient.card`]: narratorCards[
      'jun-omniscient.card'
    ] as string,
  },
  { [paths.narratorDirectory.path]: Object.keys(narratorCards) },
);

function projectWith(setting: object): StoryboardProject {
  return {
    version: '1.0.0',
    id: 'p',
    name: 'p',
    format: 'novel',
    language: 'ko',
    createdAt: '2026-09-07T00:00:00.000Z',
    editor: { scenePrefixDigits: 2 },
    setting: { tags: [], prohibitions: [], styleConstraints: [], qualityCriteria: [], ...setting },
  };
}

function sceneOf(raw: string, fileName: string): SceneFile {
  return parseScene(raw, fileName);
}

describe('readChapterNarrationDefaults', () => {
  it('reads the narrator and thread of the chapter that owns the scene', async () => {
    expect(await readChapterNarrationDefaults(paths, 1, workspaceFileSystem)).toEqual({
      narrator: 'hana-first',
      thread: 'ep1',
    });
  });

  it('reads the second chapter for the second scene', async () => {
    expect(await readChapterNarrationDefaults(paths, 2, workspaceFileSystem)).toEqual({
      narrator: 'jun-omniscient',
    });
  });

  it('returns nothing when there is no chapter plan', async () => {
    expect(await readChapterNarrationDefaults(paths, 1, fileSystemOf({}))).toEqual({});
  });
});

describe('resolveSceneNarration', () => {
  it('derives an implicit narrator from the project point of view alone', async () => {
    const narration = await resolveSceneNarration(
      paths,
      sceneOf('type: scene\nid: 01-dock\nsummary: 나룻배.\n', '01-dock.card'),
      projectWith({ pov: 'third-limited' }),
      {},
      fileSystemOf({}),
    );

    expect(narration).toMatchObject({ person: 'third', knowledge: 'witnessed' });
    expect(narration?.narratorId).toBeUndefined();
  });

  it('uses the chapter narrator when the scene card names none', async () => {
    const narration = await resolveSceneNarration(
      paths,
      sceneOf('type: scene\nid: 02-alley\nsummary: 골목.\n', '02-alley.card'),
      projectWith({ pov: 'third-limited' }),
      { narrator: 'jun-omniscient' },
      workspaceFileSystem,
    );

    expect(narration).toMatchObject({
      narratorId: 'jun-omniscient',
      knowledge: 'omniscient',
      tense: 'present',
    });
  });

  it('lets the scene card override the chapter narrator', async () => {
    const narration = await resolveSceneNarration(
      paths,
      sceneOf('type: scene\nid: 02-alley\nnarrator: hana-first\nsummary: 골목.\n', '02-alley.card'),
      projectWith({ pov: 'third-omniscient' }),
      { narrator: 'jun-omniscient' },
      workspaceFileSystem,
    );

    expect(narration).toMatchObject({ narratorId: 'hana-first', person: 'first', focal: 'hana' });
  });

  it("falls back to the scene's point-of-view character for a narrator card with no focal", async () => {
    const narration = await resolveSceneNarration(
      paths,
      sceneOf(
        'type: scene\nid: 02-alley\nnarrator: jun-omniscient\npovCharacter: jun\nsummary: 골목.\n',
        '02-alley.card',
      ),
      projectWith({}),
      {},
      workspaceFileSystem,
    );

    expect(narration?.focal).toBe('jun');
  });

  it('refuses a scene naming a narrator that has no card', async () => {
    await expect(
      resolveSceneNarration(
        paths,
        sceneOf('type: scene\nid: 02-alley\nnarrator: ghost\nsummary: 골목.\n', '02-alley.card'),
        projectWith({}),
        {},
        workspaceFileSystem,
      ),
    ).rejects.toThrow('ghost');
  });
});
