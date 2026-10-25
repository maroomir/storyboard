import {
  isHiddenSceneFileName,
  parseCardIdFromFileName,
  parseNarratorCard,
  type NarratorCard,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { loadTextFile, readDirectoryFiles } from '#engine/persistence/directoryFiles';
import type { StoryboardProjectPaths } from '@storyboard/story-model';

export async function loadNarratorCards(
  paths: StoryboardProjectPaths,
  fileSystem: IFileSystem,
): Promise<ReadonlyMap<string, NarratorCard>> {
  const cards: NarratorCard[] = await readDirectoryFiles(fileSystem, paths.narratorDirectory, {
    isEligible: (fileName) =>
      !isHiddenSceneFileName(fileName) && parseCardIdFromFileName(fileName) !== undefined,
    read: async (uri) => parseNarratorCard(await loadTextFile(fileSystem, uri)),
  });

  return new Map(cards.map((card) => [card.id, card]));
}
