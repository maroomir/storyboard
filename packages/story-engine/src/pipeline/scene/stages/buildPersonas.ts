import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import { buildGenerateOptions, buildScenePersonas } from '#engine/pipeline/sceneGenerationStages';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';

export class BuildPersonasStage implements ISceneStage {
  public readonly id: SceneStageId = 'buildPersonas';

  public async run(run: SceneGenerationRun): Promise<void> {
    run.personasUsed = await buildScenePersonas(
      run.context.characters,
      {
        ...buildGenerateOptions(run.providers, 'personaGeneration'),
        styleDirective: run.styleDirective,
      },
      run.aiService,
      run.input.personaStore,
      run.sceneRef,
      run.onProgress,
      run.shouldCancel,
    );
  }
}
