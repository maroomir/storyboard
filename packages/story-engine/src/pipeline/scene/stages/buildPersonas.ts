import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import {
  assertNotCancelled,
  buildGenerateOptions,
  withAttribution,
} from '#engine/pipeline/sceneGenerationStages';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import type { GenerateTextOptions } from '@storyboard/story-ai';
import type { CharacterCard } from '@storyboard/story-model';

export class BuildPersonasStage implements ISceneStage {
  public readonly id: SceneStageId = 'buildPersonas';

  public async run(run: SceneGenerationRun): Promise<void> {
    const personaOptions: GenerateTextOptions = {
      ...buildGenerateOptions(run.providers, 'personaGeneration'),
      styleDirective: run.styleDirective,
    };
    const personasUsed: Map<string, string> = new Map<string, string>();
    const characters: readonly CharacterCard[] = run.context.characters;

    for (const [index, character] of characters.entries()) {
      const cached: string | undefined = await run.input.personaStore?.load(character);
      let persona: string | undefined = cached;
      if (persona === undefined) {
        persona = await run.aiService.createCharacterPersona(
          character,
          withAttribution(personaOptions, {
            primary: { kind: 'character', id: character.id },
            participants: [run.sceneRef],
          }),
        );
        await run.input.personaStore?.save(character, persona);
      }
      personasUsed.set(character.name, persona);
      run.onProgress?.('buildPersonas', index + 1, characters.length);
      assertNotCancelled(run.shouldCancel);
    }

    run.personasUsed = personasUsed;
  }
}
