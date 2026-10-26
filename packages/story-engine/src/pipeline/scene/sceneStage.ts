import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';

export interface ISceneStage {
  readonly id: SceneStageId;
  run(run: SceneGenerationRun): Promise<void>;
}
