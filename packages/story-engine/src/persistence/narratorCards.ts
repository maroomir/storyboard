import {
  isHiddenSceneFileName,
  parseCardIdFromFileName,
  parseNarratorCard,
  type NarratorCard,
} from '@storyboard/story-format';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { joinStoryPath } from '#engine/paths/storyUri';
import type { StoryboardProjectPaths } from '#engine/paths/projectPaths';

// NOTE: 서술자 카드를 만들지 않은 작품이 대부분이라 디렉터리가 없는 것은 오류가 아니다. 읽을 수
// 없는 카드 하나가 생성을 막지 않도록 그 카드만 건너뛴다 — 참조가 실제로 끊겼는지는
// resolveNarration이 소리 내어 알린다.
export async function loadNarratorCards(
  paths: StoryboardProjectPaths,
  fileSystem: IFileSystem,
): Promise<ReadonlyMap<string, NarratorCard>> {
  let entries;
  try {
    entries = await fileSystem.readDirectory(paths.narratorDirectory);
  } catch {
    return new Map();
  }

  const narrators = new Map<string, NarratorCard>();

  for (const [fileName, entry] of entries) {
    if (entry.type !== 'file' || isHiddenSceneFileName(fileName)) {
      continue;
    }

    if (parseCardIdFromFileName(fileName) === undefined) {
      continue;
    }

    try {
      const bytes = await fileSystem.readFile(joinStoryPath(paths.narratorDirectory, fileName));
      const card = parseNarratorCard(new TextDecoder().decode(bytes));
      narrators.set(card.id, card);
    } catch {
      continue;
    }
  }

  return narrators;
}
