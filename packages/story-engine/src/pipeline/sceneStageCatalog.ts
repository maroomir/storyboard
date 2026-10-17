import {
  resolvePipelinePlan,
  type PipelineSpec,
  type PipelineStageDefinition,
} from '@storyboard/story-model';

// The stages a scene draft runs through, in the bundled order. Each is a unit of work over the run
// state in sceneGenerationPipeline.ts; the catalog is what a `pipelines/scene.yaml` is checked
// against, and the labels are what a host shows while a stage runs.
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
  // 뼈대를 비트마다 배우(출연 인물)·감독·인물 심판의 루프로 쓰는 대안. 명세가 이름할 때만 돈다.
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

// The bundled plan: every stage but the opt-in ones, which run only when a spec names them.
export const sceneDefaultStageIds: readonly SceneStageId[] = (
  sceneStageCatalog as readonly PipelineStageDefinition[]
)
  .filter((definition) => definition.isOptIn !== true)
  .map((definition) => definition.id as SceneStageId);

export function sceneStageLabel(id: SceneStageId): string {
  return sceneStageCatalog.find((definition) => definition.id === id)?.label ?? id;
}

// The plan in force: the bundled order until an author's spec is laid over it.
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
