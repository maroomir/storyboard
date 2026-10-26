import { castNameOf, type SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import {
  applyPlannedSceneBreaks,
  countMissingSegmentMarkers,
  ensureLeadingMarker,
  findThinDialogueBeats,
  keepOnlyMarkers,
  renderPlannedNarrative,
  type PlannedBreakResult,
  type SceneBreakPlan,
  type SkeletonCall,
} from '#engine/pipeline/sceneBreakPlan';
import {
  countMissingSceneCoordinates,
  extractSceneCoordinates,
  hasSceneCoordinates,
  sceneCoordinatesFromBeats,
  type ExtractedSceneCoordinates,
} from '#engine/pipeline/sceneCoordinates';
import { assertNotCancelled } from '#engine/pipeline/sceneGenerationStages';
import type { ResolvedSceneGenerationTuning } from '#engine/pipeline/sceneGenerationTuning';
import type { SceneGenerationPipelineAiService } from '#engine/pipeline/sceneGenerationTypes';
import { validateSceneSkeleton, type SectionViolation } from '#engine/pipeline/sceneSectionPlan';
import type { GenerateTextOptions } from '@storyboard/story-ai';
import type { SceneBeat, SceneCoverageIssue, StyleDirective } from '@storyboard/story-model';

export interface CombinedSkeletonDraft {
  readonly text: string;
  readonly warnings: readonly string[];
}

export type SkeletonCallInput = Parameters<
  SceneGenerationPipelineAiService['draftSceneSkeleton']
>[0];

export interface SkeletonDraft {
  readonly text: string;
  readonly violations: readonly SectionViolation[];
  readonly missingBeats: readonly string[];
  readonly retries: number;
}

export function adoptSkeleton(run: SceneGenerationRun, skeletonText: string): void {
  const applied: PlannedBreakResult | undefined =
    run.breakPlan === undefined ? undefined : applyPlannedSceneBreaks(skeletonText, run.breakPlan);
  if (applied !== undefined && !applied.hasNoMarkers) {
    run.skeleton = applied.text;
    run.sceneCoordinates = {
      segments: applied.coordinates,
      isAlignedWithBreaks: true,
      beats: applied.beats,
    };
    run.polishedText = run.skeleton;
    return;
  }

  const extracted: ExtractedSceneCoordinates = extractSceneCoordinates(skeletonText);
  run.skeleton = extracted.text;
  const missingCoordinates: number = countMissingSceneCoordinates(extracted.ledger);
  if (hasSceneCoordinates(extracted.ledger) && missingCoordinates === 0) {
    run.sceneCoordinates = extracted.ledger;
  } else {
    run.sceneCoordinates = sceneCoordinatesFromBeats(
      run.context.scene.card?.beats,
      castNameOf(run.context),
    );
    if (hasSceneCoordinates(extracted.ledger)) {
      run.warnings.push(
        `뼈대: 장면 표식이 ${missingCoordinates}곳 빠져 비트의 좌표를 대신 씁니다.`,
      );
    }
  }
  run.polishedText = run.skeleton;
}

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

export interface SkeletonCallBatch {
  readonly base: SkeletonCallInput;
  readonly options: GenerateTextOptions;
  readonly calls: readonly SkeletonCall[];
  readonly plan: SceneBreakPlan;
  readonly beats: readonly SceneBeat[];
  readonly targetLength: number;
}

export async function draftSkeletonInCalls(
  run: SceneGenerationRun,
  batch: SkeletonCallBatch,
): Promise<CombinedSkeletonDraft> {
  const { base, options, calls, plan, beats, targetLength } = batch;
  const castName: (ref: string) => string = castNameOf(run.context);
  const totalBeats: number = calls.reduce((sum, call) => sum + call.beats.length, 0);
  const endState: string | undefined = run.context.scene.card?.endState;
  const parts: string[] = [];
  const drafts: SkeletonDraft[] = [];

  for (const [index, call] of calls.entries()) {
    run.onProgress?.('draftSkeleton', index + 1, calls.length);
    const next: SkeletonCall | undefined = calls[index + 1];
    const nextBeat: string | undefined =
      next === undefined ? undefined : beatText(beats[next.beats[0] ?? -1]);

    const skeletonDraft: SkeletonDraft = await draftSkeletonWithRetries(
      run.aiService,
      {
        ...base,
        narrativeSource: renderPlannedNarrative(beats, plan, castName, call.beats),
        targetLength: Math.round((targetLength * call.beats.length) / totalBeats),
        ...(parts.length > 0 ? { priorSkeleton: parts.join('\n\n') } : {}),
        ...(nextBeat === undefined ? {} : { nextBeat }),
        ...(next === undefined && endState !== undefined ? { endState } : {}),
      },
      options,
      run.tuning.skeletonRetryLimit,
      run.tuning,
      plan,
      beats,
      call.beats.map((beat) => beatText(beats[beat]) ?? ''),
      call.markers,
    );
    parts.push(skeletonDraft.text);
    drafts.push(skeletonDraft);
    assertNotCancelled(run.shouldCancel);
  }

  const text: string = parts.join('\n\n');
  const reported: string[] = drafts.flatMap((draft) => draft.missingBeats);
  const stillMissing: Set<string> = new Set(
    reported.length === 0 ? [] : await findMissingBeats(run.aiService, reported, text, options),
  );
  const warnings: string[] = drafts.flatMap((draft, index) => {
    const label: string = skeletonWarningLabel(`뼈대 ${index + 1}/${calls.length}`, draft.retries);
    const kept: SectionViolation[] = [
      ...draft.violations.filter((violation) => violation.kind !== 'missing-beats'),
      ...missingBeatsViolation(draft.missingBeats.filter((beat) => stillMissing.has(beat))),
    ];
    return kept.map((violation) => `${label}: ${violation.detail}`);
  });

  return { text, warnings };
}

export async function draftSkeletonWithRetries(
  aiService: Pick<SceneGenerationPipelineAiService, 'draftSceneSkeleton' | 'checkSceneCoverage'>,
  input: Parameters<SceneGenerationPipelineAiService['draftSceneSkeleton']>[0],
  options: GenerateTextOptions,
  retryLimit: number,
  tuning: ResolvedSceneGenerationTuning,
  breakPlan: SceneBreakPlan | undefined,
  beats: readonly SceneBeat[],
  coverageBeats: readonly string[],
  segmentNumbers?: readonly number[],
): Promise<SkeletonDraft> {
  let reasons: string[] = [];
  let best:
    | {
        text: string;
        violations: readonly SectionViolation[];
        missingBeats: readonly string[];
        weight: number;
        distance: number;
      }
    | undefined;
  let retries: number = 0;

  for (let attempt: number = 0; attempt <= retryLimit; attempt += 1) {
    retries = attempt;
    const rawResponse: string = await aiService.draftSceneSkeleton(
      { ...input, ...(reasons.length > 0 ? { retryReasons: reasons } : {}) },
      options,
    );
    const response: string = curlDialogueQuotes(rawResponse);
    const skeleton: string =
      segmentNumbers === undefined
        ? response
        : keepOnlyMarkers(
            segmentNumbers[0] === undefined
              ? response
              : ensureLeadingMarker(response, segmentNumbers[0]),
            segmentNumbers,
          );
    const missingBeats: string[] = await findMissingBeats(
      aiService,
      coverageBeats,
      skeleton,
      options,
    );
    const violations: SectionViolation[] = [
      ...validateSceneSkeleton(skeleton, input.targetLength, tuning),
      ...validatePlannedSceneBreaks(skeleton, breakPlan, segmentNumbers),
      ...missingBeatsViolation(missingBeats),
    ];

    if (violations.length === 0) {
      return { text: skeleton, violations: [], missingBeats: [], retries };
    }

    const weight: number = weighViolations(violations, tuning.violationWeights);
    const distance: number =
      input.targetLength === undefined ? 0 : Math.abs(skeleton.length - input.targetLength);
    if (
      best === undefined ||
      weight < best.weight ||
      (weight === best.weight && distance < best.distance)
    ) {
      best = { text: skeleton, violations, missingBeats, weight, distance };
    }

    reasons = [
      ...violations.map((violation) => violation.detail),
      ...thinDialogueReasons(skeleton, violations, breakPlan, beats, tuning),
    ];
  }

  return {
    text: best?.text ?? '',
    violations: best?.violations ?? [],
    missingBeats: best?.missingBeats ?? [],
    retries,
  };
}

export async function findMissingBeats(
  aiService: Pick<SceneGenerationPipelineAiService, 'checkSceneCoverage'>,
  beats: readonly string[],
  skeleton: string,
  options: GenerateTextOptions,
): Promise<string[]> {
  if (beats.length === 0) {
    return [];
  }

  const issues: SceneCoverageIssue[] = await aiService.checkSceneCoverage(beats, skeleton, options);
  return issues
    .filter((issue) => issue.status === 'missing')
    .map((issue) => beats[issue.index - 1])
    .filter((beat): beat is string => beat !== undefined);
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
