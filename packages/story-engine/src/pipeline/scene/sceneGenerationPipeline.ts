import { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import { ActBeatsStage } from '#engine/pipeline/scene/stages/actBeats';
import { AttributeDialogueStage } from '#engine/pipeline/scene/stages/attributeDialogue';
import { BuildPersonasStage } from '#engine/pipeline/scene/stages/buildPersonas';
import { CheckBackgroundFactsStage } from '#engine/pipeline/scene/stages/checkBackgroundFacts';
import { CollectVoiceSamplesStage } from '#engine/pipeline/scene/stages/collectVoiceSamples';
import { DescribeBackgroundStage } from '#engine/pipeline/scene/stages/describeBackground';
import { DraftSkeletonStage } from '#engine/pipeline/scene/stages/draftSkeleton';
import { ExpandSectionStage } from '#engine/pipeline/scene/stages/expandSection';
import { PolishDialogueStage } from '#engine/pipeline/scene/stages/polishDialogue';
import { listSceneCoordinates } from '#engine/pipeline/sceneCoordinates';
import type {
  RunSceneGenerationPipelineInput,
  RunSceneGenerationPipelineResult,
} from '#engine/pipeline/sceneGenerationTypes';
import { resolveScenePipelinePlan, type SceneStageId } from '#engine/pipeline/sceneStageCatalog';

export const sceneStages: Readonly<Record<SceneStageId, ISceneStage>> = {
  buildPersonas: new BuildPersonasStage(),
  describeBackground: new DescribeBackgroundStage(),
  checkBackgroundFacts: new CheckBackgroundFactsStage(),
  collectVoiceSamples: new CollectVoiceSamplesStage(),
  draftSkeleton: new DraftSkeletonStage(),
  actBeats: new ActBeatsStage(),
  polishDialogue: new PolishDialogueStage(),
  expandSection: new ExpandSectionStage(),
  attributeDialogue: new AttributeDialogueStage(),
};

export class SceneGenerationPipeline {
  public constructor(private readonly input: RunSceneGenerationPipelineInput) {}

  public async run(): Promise<RunSceneGenerationPipelineResult> {
    const run: SceneGenerationRun = SceneGenerationRun.create(this.input);
    const plan: readonly SceneStageId[] = this.input.stages ?? resolveScenePipelinePlan();

    for (const id of plan) {
      await sceneStages[id].run(run);
    }

    return {
      draftBody: run.draftBody,
      skeleton: run.polishedText,
      sceneCoordinates: listSceneCoordinates(run.sceneCoordinates),
      warnings: run.warnings,
      detectedCharacters: run.detectedCharacters,
      personasUsed: run.personasUsed,
      providers: run.providers,
      ...(run.dialogueRecord === undefined ? {} : { dialogueRecord: run.dialogueRecord }),
      ...(run.dialoguePolish === undefined ? {} : { dialoguePolish: run.dialoguePolish }),
    };
  }
}

export async function runSceneGenerationPipeline(
  input: RunSceneGenerationPipelineInput,
): Promise<RunSceneGenerationPipelineResult> {
  return await new SceneGenerationPipeline(input).run();
}
