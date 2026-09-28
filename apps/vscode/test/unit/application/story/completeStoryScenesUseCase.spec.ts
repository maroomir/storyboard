import { describe, expect, it, vi } from 'vitest';

import { CompleteStoryScenesUseCase } from '@storyboard/story-engine';
import type {
  IStoryFeatureRepository,
  StoryFeatureSource,
} from '@storyboard/story-engine';

const workspaceRoot = {} as never;

function source(): StoryFeatureSource {
  return {
    workspaceRoot,
    project: {
      version: '1.0.0',
      id: 'story',
      name: 'Story',
      format: 'novel',
      language: 'ko',
      createdAt: '2026-07-19',
      editor: { scenePrefixDigits: 2 },
    },
    scenes: [
      {
        stem: '01-opening',
        order: 1,
        orderText: '01',
        slug: 'opening',
        frontmatter: {},
        body: '시작',
      },
      {
        stem: '03-crisis',
        order: 3,
        orderText: '03',
        slug: 'crisis',
        frontmatter: {},
        body: '위기',
      },
    ],
    cards: [
      { type: 'character', id: 'aria', name: '아리아' },
      {
        type: 'location',
        id: 'workshop',
        name: '세공소',
        locationKind: 'place',
        description: [],
        characterIds: [],
        tags: [],
      },
    ],
    canonText: '기억은 대가를 요구한다.',
    snapshots: [],
  };
}

function useCase(response: object): CompleteStoryScenesUseCase {
  const repository: IStoryFeatureRepository = {
    load: vi.fn(async () => source()),
    hasCurrentSnapshots: vi.fn(async () => true),
  };
  const gateway = {
    createService: vi.fn(() => ({
      generateText: vi.fn(async () => ({ text: JSON.stringify(response) })),
    })),
  };
  return new CompleteStoryScenesUseCase({ aiGateway: gateway as never, repository });
}

describe('CompleteStoryScenesUseCase', () => {
  it('appends consecutive names after the highest existing scene number', async () => {
    const proposal = await useCase({
      scenes: [
        {
          slug: 'choice',
          title: '선택',
          characterIds: ['aria'],
          locationId: 'workshop',
          body: '결정한다.',
        },
        { slug: 'ending', title: '결말', characterIds: ['aria'], body: '돌려준다.' },
      ],
      centralQuestion: '무엇을 남길 것인가?',
    }).execute({ workspaceRoot });

    expect(proposal.scenes.map((scene) => scene.fileName)).toEqual([
      '04-choice.card',
      '05-ending.card',
    ]);
    expect(proposal.scenes[0]?.content).toContain('characters:');
    expect(proposal.centralQuestion).toBe('무엇을 남길 것인가?');
  });

  it('rejects references to cards that do not exist', async () => {
    await expect(
      useCase({
        scenes: [{ slug: 'ending', title: '결말', characterIds: ['unknown'], body: '끝.' }],
      }).execute({ workspaceRoot }),
    ).rejects.toThrow('존재하지 않는 캐릭터 ID');
  });
});
