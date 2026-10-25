import {
  listBackgroundFactLines,
  type EntityRef,
  type Background,
  type BackgroundCard,
  type BackgroundFactConflict,
  type CharacterCard,
type AiProviderId,
} from '@storyboard/story-model';
import type { GenerateTextOptions, StoryboardAiService } from '@storyboard/story-ai';
import {
  SceneGenerationPipelineCancelledError,
  type BackgroundFactConflictStore,
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
  const providerId: AiProviderId | undefined = providers?.[task];
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
  aiService: Pick<StoryboardAiService, 'describeBackground'>,
  store: BackgroundMemoryStore | undefined,
  recentExcerpt?: string,
): Promise<Background> {
  const cached: string | undefined = recentExcerpt === undefined ? await store?.load(card) : undefined;
  let atmosphere: string | undefined = cached;
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

  const description: string[] = [...(card.description ?? []), atmosphere];
  return { ...card, description };
}

export async function findBackgroundFactConflictsForScene(
  card: BackgroundCard,
  aiService: Pick<StoryboardAiService, 'findBackgroundFactConflicts'>,
  store: BackgroundFactConflictStore | undefined,
): Promise<readonly BackgroundFactConflict[]> {
  if (listBackgroundFactLines(card).length < 2) {
    return [];
  }

  const cached: readonly BackgroundFactConflict[] | undefined = await store?.load(card);
  if (cached !== undefined) {
    return cached;
  }

  const conflicts: BackgroundFactConflict[] = await aiService.findBackgroundFactConflicts(card, {
    attribution: { primary: { kind: 'background', id: card.id } },
  });
  await store?.save(card, conflicts);

  return conflicts;
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
  const personasUsed: Map<string, string> = new Map<string, string>();
  const characterCount: number = characters.length;

  for (let i: number = 0; i < characters.length; i++) {
    const character: CharacterCard | undefined = characters[i];
    if (!character) {
      continue;
    }
    const cached: string | undefined = await personaStore?.load(character);
    let persona: string | undefined = cached;
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

