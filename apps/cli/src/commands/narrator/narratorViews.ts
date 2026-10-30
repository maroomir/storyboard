import {
  type NarratorCard,
  describeNarration,
  type NarrationDirective,
  type SceneFile,
  extractErrorMessage,
} from '@storyboard/story-model';
import type { CliContainer } from '@/container';

export function describeCard(card: NarratorCard): string {
  return describeNarration({
    person: card.person,
    knowledge: card.knowledge,
    ...(card.focal === undefined ? {} : { focal: card.focal }),
    tense: card.tense ?? 'past',
  });
}

export function toNarratorData(card: NarratorCard): Record<string, unknown> {
  return {
    id: card.id,
    name: card.name,
    person: card.person,
    knowledge: card.knowledge,
    tense: card.tense ?? 'past',
    focal: card.focal ?? null,
    voice: card.voice ?? [],
  };
}

export async function describeSceneNarration(
  container: Pick<CliContainer, 'workspaceRoot' | 'drafts'>,
  scene: SceneFile,
): Promise<string> {
  try {
    const narration: NarrationDirective | undefined = await container.drafts.resolveSceneNarration(
      container.workspaceRoot,
      scene,
    );

    return narration ? describeNarration(narration) : '지정 없음';
  } catch (error) {
    return extractErrorMessage(error);
  }
}
