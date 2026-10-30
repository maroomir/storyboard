import {
  resolveNarration,
  type NarratorCard,
  describeNarration,
  type NarrationDirective,
  type StoryboardProject,
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
  container: Pick<CliContainer, 'workspaceRoot' | 'cards' | 'project'>,
  sceneNarrator: string | undefined,
  povCharacter: string | undefined,
): Promise<string> {
  const project: StoryboardProject = await container.project.read(container.workspaceRoot);

  try {
    const narration: NarrationDirective | undefined = resolveNarration({
      ...(sceneNarrator === undefined ? {} : { sceneNarrator }),
      ...(project.setting?.narration?.defaultNarrator === undefined
        ? {}
        : { defaultNarrator: project.setting.narration.defaultNarrator }),
      ...(project.setting?.pov === undefined ? {} : { pov: project.setting.pov }),
      ...(povCharacter === undefined ? {} : { focalFallback: povCharacter }),
      narrators: await container.cards.listNarrators(container.workspaceRoot),
    });

    return narration ? describeNarration(narration) : '지정 없음';
  } catch (error) {
    return extractErrorMessage(error);
  }
}
