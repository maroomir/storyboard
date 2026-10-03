import {
  getStoryboardProjectPaths,
  isIgnoredSampleCardFileName,
  isCharacterRole,
  parseCard,
} from '@storyboard/story-model';
import { listCardFileUris } from './cardFiles';
import type { StoryUri, CharacterRole, RelationListCharacter } from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';

export interface CharacterRosterEntry {
  readonly id: string;
  readonly name: string;
  readonly role?: CharacterRole;
}

export async function loadCharacterRoster(
  fs: IFileSystem,
  workspaceRoot: StoryUri,
): Promise<CharacterRosterEntry[]> {
  const characters = await loadRelationListCharacters(fs, workspaceRoot);

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
  const uris = await listCardFileUris(
    fs,
    getStoryboardProjectPaths(workspaceRoot).characterDirectory,
  );
  const results: RelationListCharacter[] = [];

  for (const uri of uris) {
    if (isIgnoredSampleCardFileName(uri.path.split('/').at(-1) ?? '')) {
      continue;
    }

    try {
      const raw = new TextDecoder().decode(await fs.readFile(uri));
      const card = parseCard(raw);

      if (card.type !== 'character') {
        continue;
      }

      results.push({
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
      // NOTE: Unreadable or invalid cards are skipped so the relation list stays usable.
    }
  }

  return results.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
}
