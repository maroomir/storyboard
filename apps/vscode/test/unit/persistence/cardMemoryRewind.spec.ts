import { beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';

import {
  BackgroundMemoryStore,
  PersonaMemoryStore,
  type CardMemoryStoreDependencies,
  type WorkspaceCards,
} from '@storyboard/story-engine';
import { promptResourceFingerprint, promptResources } from '@storyboard/story-ai';
import {
  getStoryboardProjectPaths,
  computeBackgroundCardHash,
  computePersonaCardHash,
  type BackgroundCard,
  type CharacterCard,
  type ElementMemory,
  type SceneFile,
} from '@storyboard/story-model';
import { stubScenes } from '../../stubs/scenes';

const paths = getStoryboardProjectPaths(vscode.Uri.file('/workspace'));

const character = {
  type: 'character',
  id: 'elia',
  name: '엘리아',
  attributes: {},
} as unknown as CharacterCard;

const background = {
  type: 'background',
  id: 'school',
  name: '학교',
  attributes: {},
} as unknown as BackgroundCard;

function sceneAt(order: number, slug: string): SceneFile {
  const orderText: string = String(order).padStart(3, '0');
  return { stem: `${orderText}-${slug}`, order, orderText, slug, frontmatter: {}, body: '' } as SceneFile;
}

const scenes = stubScenes([sceneAt(2, 'second'), sceneAt(4, 'fourth'), sceneAt(5, 'fifth'), sceneAt(30, 'final')]);

describe('card memory rewind', () => {
  let memories: Map<string, ElementMemory>;
  let dependencies: CardMemoryStoreDependencies;

  const writePersona = (throughScene: string): void => {
    memories.set('character:elia:main', {
      persona: '저장된 페르소나',
      throughScene,
      cardHash: computePersonaCardHash(character, promptResourceFingerprint('personaGeneration')),
    });
  };

  const writeBackground = (throughScene: string): void => {
    memories.set('background:school:main', {
      persona: '저장된 분위기',
      throughScene,
      cardHash: computeBackgroundCardHash(background),
    });
  };

  beforeEach(() => {
    memories = new Map();
    const cards = {
      readMemory: async (_root: unknown, kind: string, slug: string, threadId: string): Promise<ElementMemory> =>
        memories.get(`${kind}:${slug}:${threadId}`) ?? {},
      writeMemory: async (
        _root: unknown,
        kind: string,
        slug: string,
        threadId: string,
        memory: ElementMemory,
      ): Promise<void> => {
        memories.set(`${kind}:${slug}:${threadId}`, memory);
      },
    } as unknown as WorkspaceCards;
    dependencies = { fileSystem: {} as never, cards, scenes };
  });

  it('reuses a persona that stopped before the scene being written', async () => {
    writePersona('004-fourth');

    const store = new PersonaMemoryStore(dependencies, paths, '005-fifth');

    expect(await store.load(character)).toBe('저장된 페르소나');
  });

  it('drops a persona that already ran past the scene being rewritten', async () => {
    writePersona('030-final');

    const store = new PersonaMemoryStore(dependencies, paths, '005-fifth');

    expect(await store.load(character)).toBeUndefined();
  });

  it('drops a persona saved by the very scene being generated again', async () => {
    writePersona('005-fifth');

    const store = new PersonaMemoryStore(dependencies, paths, '005-fifth');

    expect(await store.load(character)).toBeUndefined();
  });

  it('keeps a persona whose scene is no longer in the structure', async () => {
    writePersona('gone-scene');

    const store = new PersonaMemoryStore(dependencies, paths, '005-fifth');

    expect(await store.load(character)).toBe('저장된 페르소나');
  });

  it('drops a persona made with a persona prompt that has since been reworded', async () => {
    writePersona('004-fourth');
    promptResources.override(
      'personaGeneration',
      '---\ntemperature: 0.7\nmaxTokens: 500\n---\n## system\n고친 문구\n\n## user\n{{name}}\n',
    );

    try {
      const store = new PersonaMemoryStore(dependencies, paths, '005-fifth');

      expect(await store.load(character)).toBeUndefined();
    } finally {
      promptResources.clearOverrides();
    }
  });

  it('saves the persona with the scene it went through into the thread memory', async () => {
    const store = new PersonaMemoryStore(dependencies, paths, '005-fifth');

    await store.save(character, '새 페르소나');

    expect(memories.get('character:elia:main')).toMatchObject({ persona: '새 페르소나', throughScene: '005-fifth' });
  });

  it('rewinds background atmosphere on the same rule', async () => {
    writeBackground('030-final');
    const ahead = new BackgroundMemoryStore(dependencies, paths, '005-fifth');
    expect(await ahead.load(background)).toBeUndefined();

    writeBackground('002-second');
    const behind = new BackgroundMemoryStore(dependencies, paths, '005-fifth');
    expect(await behind.load(background)).toBe('저장된 분위기');
  });
});
