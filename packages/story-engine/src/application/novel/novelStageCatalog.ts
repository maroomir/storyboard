import {
  pipelineStageEntries,
  resolvePipelinePlan,
  type PipelineSpec,
  type PipelineStageDefinition,
  novelStageNames,
  type NovelStageName,
} from '@storyboard/story-model';


// The stages a novel run goes through, in the bundled order. The ids are the contract floor's
// `novelStageNames` (every host draws its stage rail from them); this catalog adds what a
// `pipelines/novel.yaml` is checked against.
export const novelStageCatalog = [
  { id: 'outline', label: '아웃라인', required: true },
  { id: 'characters', label: '인물 카드', required: true, requires: ['outline'] },
  { id: 'seeds', label: '씬 시드', required: true, requires: ['outline'] },
  { id: 'chapters', label: '장별 초안·검수', required: true, requires: ['characters', 'seeds'] },
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
  currentNovelPipelinePlan = resolvePipelinePlan(
    insertCharactersStage(spec),
    novelStageCatalog,
  ) as NovelStageName[];

  return currentNovelPipelinePlan;
}

// NOTE: `characters` arrived after authors had written their novel.yaml. A file that does not name
// it runs it right after `outline`, so an upgrade keeps the author's order instead of dropping it.
function insertCharactersStage(spec: PipelineSpec): PipelineSpec {
  const ids = pipelineStageEntries(spec).map((entry) => entry.id);
  const outlineIndex = ids.indexOf('outline');

  if (ids.includes('characters') || outlineIndex === -1) {
    return spec;
  }

  return {
    ...spec,
    stages: [
      ...spec.stages.slice(0, outlineIndex + 1),
      'characters',
      ...spec.stages.slice(outlineIndex + 1),
    ],
  };
}

export function resetNovelPipelinePlan(): void {
  currentNovelPipelinePlan = novelStageNames;
}

export function resolveNovelPipelinePlan(): readonly NovelStageName[] {
  return currentNovelPipelinePlan;
}
