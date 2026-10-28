import { WorkspaceFiles } from '#engine/persistence/workspaceFiles';
import {
  isHiddenSceneFileName,
  parseCardIdFromFileName,
  parseNarratorCard,
  type NarratorCard,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { StoryboardProjectPaths } from '@storyboard/story-model';

export async function loadNarratorCards(
  paths: StoryboardProjectPaths,
  fileSystem: IFileSystem,
): Promise<ReadonlyMap<string, NarratorCard>> {
  const cards: NarratorCard[] = await new WorkspaceFiles(fileSystem).readAll(
    paths.narratorDirectory,
    {
      isEligible: (fileName) =>
        !isHiddenSceneFileName(fileName) && parseCardIdFromFileName(fileName) !== undefined,
      read: async (uri) => parseNarratorCard(await new WorkspaceFiles(fileSystem).loadText(uri)),
    },
  );

  return new Map(cards.map((card) => [card.id, card]));
}
