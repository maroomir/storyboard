import { WorkspaceFiles } from '#engine/persistence/workspaceFiles';
import {
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
  isCharacterRole,
  parseCard,
} from '@storyboard/story-model';
import type {
  StoryUri,
  RelationListCharacter,
  StoryboardCard,
  CharacterRosterEntry,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';

export async function loadCharacterRoster(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
): Promise<CharacterRosterEntry[]> {
  const characters: RelationListCharacter[] = await loadRelationListCharacters(fs, workspaceRoot);

  return characters.map((character) => ({
    id: character.id,
    name: character.name,
    ...(character.role !== undefined && isCharacterRole(character.role)
      ? { role: character.role }
      : {}),
  }));
}

export async function loadRelationListCharacters(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
): Promise<RelationListCharacter[]> {
  const uris: StoryUri[] = await new WorkspaceFiles(fs).listCardUris(
    getStoryboardProjectPaths(workspaceRoot).characterDirectory,
  );
  const listCharacters: RelationListCharacter[] = [];

  for (const uri of uris) {
    if (isIgnoredSampleCardFileName(uri.path.split('/').at(-1) ?? '')) {
      continue;
    }

    try {
      const raw: string = new TextDecoder().decode(await fs.readFile(uri));
      const card: StoryboardCard = parseCard(raw);

      if (card.type !== 'character') {
        continue;
      }

      listCharacters.push({
        id: card.id,
        name: card.name,
        ...(card.role === undefined ? {} : { role: card.role }),
        uri: uri.toString(),
        relations: (card.relations ?? []).map((relation) => ({
          target: relation.target,
          type: relation.type,
        })),
      });
    } catch {
      continue;
    }
  }

  return listCharacters.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
}
