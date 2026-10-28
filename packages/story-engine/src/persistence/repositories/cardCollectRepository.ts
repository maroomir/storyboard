import {
  getStoryboardProjectPaths,
  isCharacterRole,
  isIgnoredSampleCardFileName,
  parseCard,
  parseDraft,
  readDraftFile,
} from '@storyboard/story-model';
import type {
  CharacterRef,
  CharacterRosterEntry,
  Draft,
  RelationListCharacter,
  StoryboardCard,
  StoryUri,
} from '@storyboard/story-model';
import type { CollectDraft } from '#engine/ai/cardCollectBuilder';
import type { ICardCollectRepository } from '#engine/application/cards/cardRepositories';
import { WorkspaceFiles } from '#engine/persistence/workspaceFiles';
import type { IFileSystem } from '#engine/ports/fileSystem';

export class CardCollectRepository implements ICardCollectRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async loadCharacterRoster(workspaceRoot: StoryUri): Promise<readonly CharacterRef[]> {
    const characters: RelationListCharacter[] = await this.listRelationCharacters(workspaceRoot);

    return characters.map(
      (character): CharacterRosterEntry => ({
        id: character.id,
        name: character.name,
        ...(character.role !== undefined && isCharacterRole(character.role)
          ? { role: character.role }
          : {}),
      }),
    );
  }

  public async listRelationCharacters(workspaceRoot: StoryUri): Promise<RelationListCharacter[]> {
    const uris: StoryUri[] = await new WorkspaceFiles(this.fileSystem).listCardUris(
      getStoryboardProjectPaths(workspaceRoot).characterDirectory,
    );
    const listCharacters: RelationListCharacter[] = [];

    for (const uri of uris) {
      if (isIgnoredSampleCardFileName(uri.path.split('/').at(-1) ?? '')) {
        continue;
      }

      try {
        const raw: string = new TextDecoder().decode(await this.fileSystem.readFile(uri));
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

  public async loadDrafts(workspaceRoot: StoryUri): Promise<readonly CollectDraft[]> {
    const { draftDirectory } = getStoryboardProjectPaths(workspaceRoot);

    return await new WorkspaceFiles(this.fileSystem).readAll(draftDirectory, {
      isEligible: (name) => name.endsWith('.md'),
      read: async (uri): Promise<CollectDraft> => {
        const draft: Draft = parseDraft(await readDraftFile(uri, this.fileSystem));
        return { body: draft.body, sceneStem: draft.sceneStem };
      },
    });
  }
}
