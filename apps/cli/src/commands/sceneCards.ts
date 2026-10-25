import {
  joinStoryPath,
  type StoryUri,
  parseSceneCard,
  type SceneCard,
} from '@storyboard/story-model';

import type { CliContainer } from '@/container';

export interface ReadSceneCardsResult {
  readonly cards: readonly { readonly fileName: string; readonly card: SceneCard }[];
  readonly unreadable: readonly string[];
}

export async function readSceneCards(
  container: CliContainer,
  sceneDirectory: StoryUri,
  fileNames: readonly string[],
): Promise<ReadSceneCardsResult> {
  const cards: { fileName: string; card: SceneCard }[] = [];
  const unreadable: string[] = [];

  for (const fileName of fileNames.filter((name) => name.endsWith('.card'))) {
    const uri: StoryUri = joinStoryPath(sceneDirectory, fileName);
    const text: string = new TextDecoder().decode(await container.fileSystem.readFile(uri));

    try {
      cards.push({ fileName, card: parseSceneCard(text) });
    } catch {
      unreadable.push(fileName);
    }
  }

  return { cards, unreadable };
}
