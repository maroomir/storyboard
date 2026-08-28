import type { EntityRef, GenerateTextOptions, StoryboardAIService } from '@storyboard/story-ai';
import type { Background } from '@storyboard/story-format';
import type { BackgroundCard, CharacterCard } from '@storyboard/story-format';
import {
  SceneGenerationPipelineCancelledError,
  type BackgroundMemoryStore,
  type PersonaMemoryStore,
  type RunSceneGenerationPipelineInput,
  type SceneGenerationPipelineAiService,
  type SceneGenerationPipelineTaskProviders,
} from './sceneGenerationTypes';

export function buildGenerateOptions(
  providers: Readonly<SceneGenerationPipelineTaskProviders> | undefined,
  task: keyof SceneGenerationPipelineTaskProviders,
): GenerateTextOptions | undefined {
  const providerId = providers?.[task];
  return providerId ? { providerId } : undefined;
}

export function withAttribution(
  options: GenerateTextOptions | undefined,
  attribution: GenerateTextOptions['attribution'],
): GenerateTextOptions {
  return { ...options, attribution };
}


export async function describeBackgroundForScene(
  card: BackgroundCard,
  aiService: Pick<StoryboardAIService, 'describeBackground'>,
  store: BackgroundMemoryStore | undefined,
): Promise<Background> {
  const cached = await store?.load(card);
  let atmosphere = cached;
  if (atmosphere === undefined) {
    atmosphere = await aiService.describeBackground(card, {
      attribution: { primary: { kind: 'background', id: card.id } },
    });
    await store?.save(card, atmosphere);
  }

  if (atmosphere.length === 0) {
    return card;
  }

  const description = [...(card.description ?? []), atmosphere];
  return { ...card, description };
}

export function assertNotCancelled(shouldCancel: (() => boolean) | undefined): void {
  if (shouldCancel?.()) {
    throw new SceneGenerationPipelineCancelledError();
  }
}

export async function buildScenePersonas(
  characters: readonly CharacterCard[],
  personaOptions: GenerateTextOptions,
  aiService: Pick<SceneGenerationPipelineAiService, 'createCharacterPersona'>,
  personaStore: PersonaMemoryStore | undefined,
  sceneRef: EntityRef,
  onProgress: RunSceneGenerationPipelineInput['onProgress'],
  shouldCancel: (() => boolean) | undefined,
): Promise<Map<string, string>> {
  const personasUsed = new Map<string, string>();
  const characterCount = characters.length;

  for (let i = 0; i < characters.length; i++) {
    const character = characters[i];
    if (!character) {
      continue;
    }
    const cached = await personaStore?.load(character);
    let persona = cached;
    if (persona === undefined) {
      persona = await aiService.createCharacterPersona(
        character,
        withAttribution(personaOptions, {
          primary: { kind: 'character', id: character.id },
          participants: [sceneRef],
        }),
      );
      await personaStore?.save(character, persona);
    }
    personasUsed.set(character.name, persona);
    onProgress?.('buildPersonas', i + 1, characterCount);
    assertNotCancelled(shouldCancel);
  }

  return personasUsed;
}

// NOTE: 압축 tail은 예산에 밀려 초반 비트가 잘려 나가므로, 이 장면에서 이미 쓴 대목을 목록으로
// 따로 넘긴다. situations는 이미 손에 있어 추가 AI 호출이 없다. 이것이 없으면 뒤 비트가 앞에서
// 끝낸 도입(입장·인사·첫 질문)을 다시 쓴다.
