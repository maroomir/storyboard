import {
  countMissingSegmentMarkers,
  findThinDialogueBeats,
  type SceneBreakPlan,
} from '#engine/pipeline/sceneBreakPlan';
import type { ResolvedSceneGenerationTuning } from '#engine/pipeline/sceneGenerationTuning';
import type { SectionViolation } from '#engine/pipeline/sceneSectionPlan';
import type { SceneBeat, StyleDirective } from '@storyboard/story-model';

export function beatText(beat: SceneBeat | undefined): string | undefined {
  return beat === undefined ? undefined : typeof beat === 'string' ? beat : beat.text;
}

export function buildSkeletonContext(
  previousContext: string | undefined,
  canonFactLines: readonly string[] | undefined,
): string | undefined {
  const sections: string[] = [
    canonFactLines && canonFactLines.length > 0
      ? `[설정 메모]\n${canonFactLines.map((line) => `- ${line}`).join('\n')}\n(작가 참고용 배경지식이다. 인물이 아직 모르는 사실을 대사·사건으로 드러내지 마라.)`
      : undefined,
    previousContext,
  ].filter((section): section is string => Boolean(section));

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

export function curlDialogueQuotes(text: string): string {
  return text.replace(/"([^"\n]+)"/g, '“$1”');
}

export function missingBeatsViolation(missing: readonly string[]): SectionViolation[] {
  if (missing.length === 0) {
    return [];
  }

  const listed: string = missing
    .slice(0, thinBeatListLimit)
    .map((text) => `«${shortBeat(text)}»`)
    .join('·');
  return [
    {
      kind: 'missing-beats',
      detail: `사건 ${listed}${missing.length > thinBeatListLimit ? ` 외 ${missing.length - thinBeatListLimit}개` : ''}이 뼈대에 없습니다. 사건 목록의 사건을 순서대로 빠짐없이 담으세요`,
    },
  ];
}

export function shortBeat(text: string): string {
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

export function skeletonTargetLength(
  styleDirective: StyleDirective | undefined,
  skeletonRatio: number,
): number | undefined {
  const target: number | undefined = styleDirective?.targetWordCount;
  return target === undefined ? undefined : Math.round(target * skeletonRatio);
}

export function skeletonWarningLabel(call: string, retries: number): string {
  return retries > 0 ? `${call} (재시도 ${retries}회 뒤 채택한 판)` : call;
}

export const thinBeatListLimit: number = 6;

export function thinDialogueReasons(
  skeleton: string,
  violations: readonly SectionViolation[],
  breakPlan: SceneBreakPlan | undefined,
  beats: readonly SceneBeat[],
  tuning: ResolvedSceneGenerationTuning,
): string[] {
  if (breakPlan === undefined || !violations.some((violation) => violation.kind === 'too-short')) {
    return [];
  }

  const thin: string[] = findThinDialogueBeats(
    skeleton,
    breakPlan,
    beats,
    tuning.skeletonThinDialogueTurns,
  );
  if (thin.length === 0) {
    return [];
  }

  const listed: string = thin
    .slice(0, thinBeatListLimit)
    .map((text) => `«${text}»`)
    .join('·');
  return [
    `사건 ${listed}${thin.length > thinBeatListLimit ? ` 외 ${thin.length - thinBeatListLimit}개` : ''}의 대화가 짧습니다. 이 사건들은 각각 ${tuning.skeletonRequestedDialogueTurns}턴 이상 밀고 당기게 늘리세요`,
  ];
}

export function validatePlannedSceneBreaks(
  skeleton: string,
  breakPlan: SceneBreakPlan | undefined,
  segmentNumbers?: readonly number[],
): SectionViolation[] {
  if (breakPlan === undefined) {
    return [];
  }

  const missingMarkers: number = countMissingSegmentMarkers(
    skeleton,
    segmentNumbers ?? breakPlan.segments.map((_, index) => index + 1),
  );
  return missingMarkers === 0
    ? []
    : [
        {
          kind: 'scene-breaks',
          detail: `⟪대목 n⟫ 표식 ${missingMarkers}개가 빠져 그 대목이 앞 대목에 붙었습니다. 사건 목록의 ⟪대목⟫ 줄을 모두 그 자리에 옮겨 적으세요`,
        },
      ];
}

export function weighViolations(
  violations: readonly SectionViolation[],
  weights: ResolvedSceneGenerationTuning['violationWeights'],
): number {
  return violations.reduce((total, violation) => total + weights[violation.kind], 0);
}
