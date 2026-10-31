import {
  resolvePipelinePlan,
  type PipelineSpec,
  type PipelineStageDefinition,
} from '@storyboard/story-model';

export const sceneStageCatalog = [
  { id: 'buildPersonas', label: '인물 기억', required: true },
  { id: 'describeBackground', label: '배경 묘사', required: true },
  { id: 'checkBackgroundFacts', label: '배경 사실 점검' },
  { id: 'collectVoiceSamples', label: '말투 표본' },
  {
    id: 'draftSkeleton',
    label: '뼈대',
    required: true,
    requires: ['buildPersonas', 'describeBackground'],
  },
  {
    id: 'actBeats',
    label: '배우 뼈대',
    requires: ['buildPersonas', 'describeBackground'],
    replaces: 'draftSkeleton',
    isOptIn: true,
  },
  { id: 'polishDialogue', label: '대사 다듬기', requires: ['draftSkeleton'] },
  { id: 'expandSection', label: '살붙임', required: true, requires: ['draftSkeleton'] },
  { id: 'attributeDialogue', label: '화자 붙이기', requires: ['expandSection'] },
] as const satisfies readonly PipelineStageDefinition[];

export type SceneStageId = (typeof sceneStageCatalog)[number]['id'];

export const sceneStageIds: readonly SceneStageId[] = sceneStageCatalog.map(
  (definition) => definition.id,
);

export const sceneDefaultStageIds: readonly SceneStageId[] = (
  sceneStageCatalog as readonly PipelineStageDefinition[]
)
  .filter((definition) => definition.isOptIn !== true)
  .map((definition) => definition.id as SceneStageId);

let currentScenePipelinePlan: readonly SceneStageId[] = sceneDefaultStageIds;

export function overrideScenePipelinePlan(spec: PipelineSpec): readonly SceneStageId[] {
  currentScenePipelinePlan = resolvePipelinePlan(spec, sceneStageCatalog) as SceneStageId[];

  return currentScenePipelinePlan;
}

export function resetScenePipelinePlan(): void {
  currentScenePipelinePlan = sceneDefaultStageIds;
}

export function resolveScenePipelinePlan(): readonly SceneStageId[] {
  return currentScenePipelinePlan;
}
