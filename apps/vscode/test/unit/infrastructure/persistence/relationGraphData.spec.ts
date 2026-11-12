import { stubFileSystem } from '../../../stubs/fileSystem';
import { stubCards } from '../../../stubs/cards';

import { describe, expect, it } from 'vitest';

import { CardCollectRepository } from '@storyboard/story-engine';
import { parseCard, type CharacterCard } from '@storyboard/story-model';
import { Uri } from '../../../stubs/vscode';

const characterFixture: string = "type: character\nid: elia\nname: 엘리아\nprofile: profile/elia.png\nrole: main\nattributes:\n  age: 17\n  sex: female\n  mbti: ENFJ\ntraits:\n  - 활발하게 움직임\n  - 결단력 있는 발언\ndescription:\n  - 주인공. 학교에 첫 등교한 17세 여학생.\n  - 새로운 학교 생활에 대한 기대와 긴장을 함께 품고 있다.\ndesire:\n  - 새 학교에서 진짜 친구를 만들고 싶다\nrelations:\n  - target: jihoon\n    type: 친구\narc: 학교에 도착해 새 친구를 만남\n";

describe('loadRelationListCharacters', () => {
  const elia = parseCard(characterFixture) as CharacterCard;

  it('loads relations from the character cards', async () => {
    const workspaceRoot = Uri.file('/workspace/story');

    const characters = await new CardCollectRepository(
      stubFileSystem,
      stubCards({ characters: [elia] }),
    ).listRelationCharacters(workspaceRoot as never);

    expect(characters).toHaveLength(1);
    expect(characters[0]).toMatchObject({
      id: 'elia',
      name: '엘리아',
      role: 'main',
      relations: [{ target: 'jihoon', type: '친구' }],
    });
  });

  it('lists no one when the work has no character card', async () => {
    const characters = await new CardCollectRepository(stubFileSystem, stubCards()).listRelationCharacters(
      Uri.file('/workspace/story') as never,
    );

    expect(characters).toEqual([]);
  });

  it('loads character roster without relations payload', async () => {
    const roster = await new CardCollectRepository(
      stubFileSystem,
      stubCards({ characters: [elia] }),
    ).loadCharacterRoster(Uri.file('/workspace/story') as never);

    expect(roster).toEqual([{ id: 'elia', name: '엘리아', role: 'main' }]);
  });
});
