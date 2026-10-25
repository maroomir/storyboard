import { pipelineDefaults } from '@storyboard/story-engine';
import { sectionViolationKinds, type SectionViolationKind } from '@storyboard/story-model';

export interface SceneMetrics {
  readonly sceneStem: string;
  readonly targetLength: number;
  readonly draftLength: number;
  readonly reach: number;
  readonly warnings: readonly string[];
  readonly warningWeight: number;
}

export function weighWarnings(warnings: readonly string[]): number {
  return warnings.reduce((total, warning) => {
    const kind: SectionViolationKind | undefined = sectionViolationKinds.find((candidate) =>
      warning.includes(candidate),
    );
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
  const meanReach: number =
    scenes.length === 0
      ? 0
      : scenes.reduce((total, scene) => total + scene.reach, 0) / scenes.length;

  return {
    scenes,
    meanReach,
    totalWarningWeight: scenes.reduce((total, scene) => total + scene.warningWeight, 0),
  };
}
