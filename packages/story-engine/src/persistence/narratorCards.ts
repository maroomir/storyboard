import {
  isHiddenSceneFileName,
  parseCardIdFromFileName,
  parseNarratorCard,
  type NarratorCard,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { loadTextFile, readDirectoryFiles } from '#engine/persistence/directoryFiles';
import type { StoryboardProjectPaths } from '@storyboard/story-model';

// NOTE: 서술자 카드를 만들지 않은 작품이 대부분이라 디렉터리가 없는 것은 오류가 아니다. 읽을 수
// 없는 카드 하나가 생성을 막지 않도록 그 카드만 건너뛴다 — 참조가 실제로 끊겼는지는
// resolveNarration이 소리 내어 알린다.
export async function loadNarratorCards(
  paths: StoryboardProjectPaths,
  fileSystem: IFileSystem,
): Promise<ReadonlyMap<string, NarratorCard>> {
  const cards = await readDirectoryFiles(fileSystem, paths.narratorDirectory, {
    isEligible: (fileName) =>
      !isHiddenSceneFileName(fileName) && parseCardIdFromFileName(fileName) !== undefined,
    read: async (uri) => parseNarratorCard(await loadTextFile(fileSystem, uri)),
  });

  return new Map(cards.map((card) => [card.id, card]));
}
