import { joinStoryPath, type StoryUri } from '@storyboard/story-engine';
import { parseSceneCard, type SceneCard } from '@storyboard/story-format';

import type { CliContainer } from '@/container';

export interface ReadSceneCardsResult {
  readonly cards: readonly { readonly fileName: string; readonly card: SceneCard }[];
  readonly unreadable: readonly string[];
}

// 한 카드가 깨졌다고 doctor 나 migrate 전체가 죽으면 안 된다. 깨진 파일은 이름만 모아 보고한다.
export async function readSceneCards(
  container: CliContainer,
  sceneDirectory: StoryUri,
  fileNames: readonly string[],
): Promise<ReadSceneCardsResult> {
  const cards: { fileName: string; card: SceneCard }[] = [];
  const unreadable: string[] = [];

  for (const fileName of fileNames.filter((name) => name.endsWith('.card'))) {
    const uri = joinStoryPath(sceneDirectory, fileName);
    const text = new TextDecoder().decode(await container.fileSystem.readFile(uri));

    try {
      cards.push({ fileName, card: parseSceneCard(text) });
    } catch {
      unreadable.push(fileName);
    }
  }

  return { cards, unreadable };
}
