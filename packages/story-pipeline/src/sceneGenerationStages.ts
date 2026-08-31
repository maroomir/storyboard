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


// NOTE: 발췌가 있으면 같은 장소가 다시 나온 것이므로 캐시를 건너뛰고 묘사를 갱신한다. 캐시를 그대로
// 쓰면 첫 등장 씬에서 만든 한 단락이 작품 끝까지 고정돼 장소에 놓인 것들이 누적되지 않는다.
// 그렇게 만든 묘사는 이 씬에서만 쓰고 저장하지 않는다. 씬 순서에 딸린 값을 카드 키 슬롯에 쓰면
// 마지막에 실행된 씬이 그 장소의 정본을 덮어써, 앞 씬이 뒤 씬의 묘사를 물려받는다.
export async function describeBackgroundForScene(
  card: BackgroundCard,
  aiService: Pick<StoryboardAIService, 'describeBackground'>,
  store: BackgroundMemoryStore | undefined,
  recentExcerpt?: string,
): Promise<Background> {
  const cached = recentExcerpt === undefined ? await store?.load(card) : undefined;
  let atmosphere = cached;
  if (atmosphere === undefined) {
    atmosphere = await aiService.describeBackground(
      card,
      { attribution: { primary: { kind: 'background', id: card.id } } },
      recentExcerpt,
    );

    if (recentExcerpt === undefined) {
      await store?.save(card, atmosphere);
    }
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
