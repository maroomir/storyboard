import { pipelineDefaults, sectionViolationKinds } from '@storyboard/story-pipeline';

// 심판을 부르지 않고도 나오는 신호들. 선별 단계는 이것만으로 손잡이 순위를 매긴다 — 온도 낮은
// 판정이라도 한 지점에 수십 번 부르면 격자보다 심판이 비싸진다.

export interface SceneMetrics {
  readonly sceneStem: string;
  readonly targetLength: number;
  readonly draftLength: number;
  // 목표 대비 실제 분량. 하니스가 재던 값과 같은 정의다.
  readonly reach: number;
  readonly warnings: readonly string[];
  readonly warningWeight: number;
}

// NOTE: 경고 개수만 세면 «인물이 새로 등장했다» 와 «분량이 조금 모자라다» 가 같은 무게가 된다.
// 파이프라인이 재시도 후보를 고를 때 쓰는 저울을 그대로 빌려 쓴다.
export function weighWarnings(warnings: readonly string[]): number {
  return warnings.reduce((total, warning) => {
    const kind = sectionViolationKinds.find((candidate) => warning.includes(candidate));
    return total + (kind === undefined ? 1 : pipelineDefaults.violationWeights[kind]);
  }, 0);
}

export function measureScene(input: {
  readonly sceneStem: string;
  readonly targetLength: number;
  readonly draft: string;
  readonly warnings: readonly string[];
}): SceneMetrics {
  return {
    sceneStem: input.sceneStem,
    targetLength: input.targetLength,
    draftLength: input.draft.length,
    reach: input.targetLength === 0 ? 0 : input.draft.length / input.targetLength,
    warnings: input.warnings,
    warningWeight: weighWarnings(input.warnings),
  };
}

export interface TrackMetrics {
  readonly scenes: readonly SceneMetrics[];
  readonly meanReach: number;
  readonly totalWarningWeight: number;
}

export function summarizeScenes(scenes: readonly SceneMetrics[]): TrackMetrics {
  const meanReach =
    scenes.length === 0
      ? 0
      : scenes.reduce((total, scene) => total + scene.reach, 0) / scenes.length;

  return {
    scenes,
    meanReach,
    totalWarningWeight: scenes.reduce((total, scene) => total + scene.warningWeight, 0),
  };
}
