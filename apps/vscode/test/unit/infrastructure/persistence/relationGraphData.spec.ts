import { stubFileSystem } from '../../../stubs/fileSystem';
import { stubCards } from '../../../stubs/cards';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { CardCollectRepository } from '@storyboard/story-engine';
import { parseCard, type CharacterCard } from '@storyboard/story-model';
import { Uri } from '../../../stubs/vscode';

const characterFixture = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../../../packages/story-model/test/fixtures/cards/character.card',
      import.meta.url,
    ),
  ),
  'utf8',
);

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
