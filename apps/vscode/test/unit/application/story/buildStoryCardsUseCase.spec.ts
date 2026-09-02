import { describe, expect, it, vi } from 'vitest';

import {
  BuildStoryCardsUseCase,
  applyStoryCardChanges,
} from '@storyboard/story-engine';
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
        body: '아리아가 작업장에 선다.',
      },
    ],
    cards: [
      {
        type: 'character',
        id: 'aria',
        name: '아리아',
        profile: 'profile/aria.png',
        traits: ['신중함'],
      },
    ],
    canonText: '',
    snapshots: [],
  };
}

function useCase(response: object): BuildStoryCardsUseCase {
  const repository: IStoryFeatureRepository = {
    load: vi.fn(async () => source()),
    hasCurrentSnapshots: vi.fn(async () => true),
  };
  const gateway = {
    createService: vi.fn(() => ({
      generateText: vi.fn(async () => ({ text: JSON.stringify(response) })),
    })),
  };
  return new BuildStoryCardsUseCase(gateway as never, repository);
}

describe('tolerating empty optional fields', () => {
  // 모델은 모르는 값을 "" 로 적어 보낸다. 그걸 오류로 세면 씬 전편을 읽고 온 응답이
  // weather 한 칸 때문에 통째로 버려지고, 카드가 하나도 만들어지지 않는다.
  it('reads an empty optional string as absent instead of failing the batch', async () => {
    const proposal = await useCase({
      entities: [
        {
          type: 'background',
          name: '방송실',
          time: '',
          weather: '',
          tags: ['학교', ''],
          description: ['', '점심마다 진아가 앉는 자리.'],
          sourceScenes: ['01-opening'],
        },
      ],
    }).execute(workspaceRoot);

    expect(proposal.targets).toHaveLength(1);
    const card = proposal.targets[0]?.card as { tags?: string[] };
    expect(card.tags).not.toContain('');
  });
});

describe('BuildStoryCardsUseCase', () => {
  it('proposes only additive selected fields and preserves an existing profile', async () => {
    const proposal = await useCase({
      entities: [
        {
          type: 'character',
          existingId: 'aria',
          name: '아리아',
          traits: ['용감함'],
          aliases: ['세공사'],
          sourceScenes: ['01-opening'],
        },
      ],
    }).execute(workspaceRoot);
    const target = proposal.targets[0];
    if (!target) {
      throw new Error('Expected target');
    }

    const result = applyStoryCardChanges(
      target,
      target.changes.map((change) => change.proposal),
    );
    expect(result).toMatchObject({
      profile: 'profile/aria.png',
      aliases: ['세공사'],
      traits: ['신중함', '용감함'],
    });
  });

  it('rejects an entity whose evidence is not one of the supplied scenes', async () => {
    await expect(
      useCase({
        entities: [
          { type: 'character', existingId: 'aria', name: '아리아', sourceScenes: ['99-unknown'] },
        ],
      }).execute(workspaceRoot),
    ).rejects.toThrow('알 수 없는 근거 씬');
  });
});
