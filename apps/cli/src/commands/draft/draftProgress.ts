import { sceneStageCatalog, type GenerateAllDraftsProgress } from '@storyboard/story-engine';

export const sceneStageLabels: Record<string, string> = Object.fromEntries(
  sceneStageCatalog.map((definition) => [definition.id, definition.label]),
);

export function describeBatchStep(progress: GenerateAllDraftsProgress): string {
  switch (progress.kind) {
    case 'prepared':
      return '준비';
    case 'pipeline':
      return progress.stage === undefined
        ? '생성'
        : `${sceneStageLabels[progress.stage] ?? progress.stage} ${progress.stageCurrent ?? 0}/${progress.stageTotal ?? 0}`;
    case 'saving':
      return '저장';
    case 'revising':
      return '검수·수정';
  }
}

export function describeBatchFailure(kind: 'no_projects' | 'no_scenes'): string {
  return kind === 'no_projects'
    ? 'Storyboard 프로젝트를 찾을 수 없습니다.'
    : '생성할 씬이 없습니다. scene/*.card 를 먼저 만들어 주세요.';
}
