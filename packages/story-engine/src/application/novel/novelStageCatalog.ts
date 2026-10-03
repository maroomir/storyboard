import {
  resolvePipelinePlan,
  type PipelineSpec,
  type PipelineStageDefinition,
} from '@storyboard/story-model';

import { novelStageNames, type NovelStageName } from '#engine/shared/novelRun';

// The stages a novel run goes through, in the bundled order. The ids are the contract floor's
// `novelStageNames` (every host draws its stage rail from them); this catalog adds what a
// `pipelines/novel.yaml` is checked against.
export const novelStageCatalog = [
  { id: 'outline', label: '아웃라인', required: true },
  { id: 'seeds', label: '씬 시드', required: true, requires: ['outline'] },
  { id: 'chapters', label: '장별 초안·검수', required: true, requires: ['seeds'] },
  { id: 'assemble', label: '원고 조립', requires: ['chapters'] },
  { id: 'review', label: '원고 최종 검사', requires: ['assemble'] },
  { id: 'revise-from-review', label: '검수 결과 재작성', requires: ['review'] },
  { id: 'summaries', label: '장별 요약', requires: ['chapters'] },
] as const satisfies readonly (PipelineStageDefinition & { readonly id: NovelStageName })[];

export function novelStageLabel(id: NovelStageName): string {
  return novelStageCatalog.find((definition) => definition.id === id)?.label ?? id;
}

// The plan in force: the bundled order until an author's spec is laid over it.
let currentNovelPipelinePlan: readonly NovelStageName[] = novelStageNames;

export function overrideNovelPipelinePlan(spec: PipelineSpec): readonly NovelStageName[] {
  currentNovelPipelinePlan = resolvePipelinePlan(spec, novelStageCatalog) as NovelStageName[];

  return currentNovelPipelinePlan;
}

export function resetNovelPipelinePlan(): void {
  currentNovelPipelinePlan = novelStageNames;
}

export function resolveNovelPipelinePlan(): readonly NovelStageName[] {
  return currentNovelPipelinePlan;
}
