import { curlDialogueQuotes } from '#engine/pipeline/dialogueQuotes';
import { characterSpeechToOthers } from '#engine/pipeline/scene/characterVoices';
import { castNameOf, type SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import {
  beatText,
  buildSkeletonContext,
  missingBeatsViolation,
  reversedBeatsViolation,
  skeletonTargetLength,
  skeletonWarningLabel,
  thinDialogueReasons,
  validatePlannedSceneBreaks,
  weighViolations,
} from '#engine/pipeline/scene/skeletonChecks';
import {
  applyPlannedSceneBreaks,
  ensureLeadingMarker,
  keepOnlyMarkers,
  planSkeletonCalls,
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
import {
  assertNotCancelled,
  buildGenerateOptions,
  withAttribution,
} from '#engine/pipeline/sceneGenerationStages';
import type { SceneGenerationPipelineAiService, SceneWarning } from '#engine/pipeline/sceneGenerationTypes';
import {
  findSeamRepeatViolations,
  validateSceneSkeleton,
  type SectionViolation,
} from '#engine/pipeline/sectionValidation';
import {
  findBeatCoinedAddresses,
  findWithheldAddressTermsUsed,
  listAddressTermsCoinedAfter,
  withholdCatchphrases,
  type CoinedAddress,
} from '#engine/pipeline/addressTerms';
import { characterCatchphrases, type GenerateTextOptions } from '@storyboard/story-ai';
import {
  formatBackgroundFactConflict,
  type CoverageStatus,
  type SceneBeat,
  type SceneCoverageIssue,
  type TraceBeatStatus,
  type TraceCallTag,
} from '@storyboard/story-model';

export interface CombinedSkeletonDraft {
  readonly text: string;
  readonly warnings: readonly SceneWarning[];
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

export interface SkeletonCallBatch {
  readonly base: SkeletonCallInput;
  readonly options: GenerateTextOptions;
  readonly calls: readonly SkeletonCall[];
  readonly plan: SceneBreakPlan;
  readonly targetLength: number;
}

interface BestSkeletonAttempt {
  readonly text: string;
  readonly violations: readonly SectionViolation[];
  readonly missingBeats: readonly string[];
  readonly weight: number;
  readonly distance: number;
}

interface CheckedSkeleton {
  readonly text: string;
  readonly violations: readonly SectionViolation[];
  readonly missingBeats: readonly string[];
}

interface SkeletonCoverageGaps {
  readonly missingBeats: readonly string[];
  readonly reversedBeats: readonly string[];
}

function keepSegmentMarkers(
  response: string,
  segmentNumbers: readonly number[] | undefined,
): string {
  if (segmentNumbers === undefined) {
    return response;
  }

  const firstSegment: number | undefined = segmentNumbers[0];
  const withLeadingMarker: string =
    firstSegment === undefined ? response : ensureLeadingMarker(response, firstSegment);
  return keepOnlyMarkers(withLeadingMarker, segmentNumbers);
}

function earlyAddressViolation(earlyTerms: readonly string[]): SectionViolation[] {
  if (earlyTerms.length === 0) {
    return [];
  }

  return [
    {
      kind: 'address',
      detail: `뒤 사건에서 처음 붙는 호칭을 앞당겨 썼습니다 (${earlyTerms.map((term) => `«${term}»`).join(', ')}). 이번 사건들에서는 이름이나 다른 말로 부르세요`,
    },
  ];
}

class SkeletonRetryTally {
  private reasons: string[] = [];
  private best: BestSkeletonAttempt | undefined;
  private retries: number = 0;

  public startAttempt(attempt: number): void {
    this.retries = attempt;
  }

  public addRetryReasons(input: SkeletonCallInput): SkeletonCallInput {
    return { ...input, ...(this.reasons.length > 0 ? { retryReasons: this.reasons } : {}) };
  }

  public recordRejected(candidate: BestSkeletonAttempt, reasons: string[]): void {
    const { best } = this;
    if (
      best === undefined ||
      candidate.weight < best.weight ||
      (candidate.weight === best.weight && candidate.distance < best.distance)
    ) {
      this.best = candidate;
    }

    this.reasons = reasons;
  }

  public toAcceptedDraft(text: string): SkeletonDraft {
    return { text, violations: [], missingBeats: [], retries: this.retries };
  }

  public toBestDraft(): SkeletonDraft {
    return {
      text: this.best?.text ?? '',
      violations: this.best?.violations ?? [],
      missingBeats: this.best?.missingBeats ?? [],
      retries: this.retries,
    };
  }
}

export class SkeletonDrafter {
  private readonly beats: readonly SceneBeat[];

  private readonly coinedAddresses: readonly CoinedAddress[];

  public constructor(private readonly run: SceneGenerationRun) {
    this.beats = run.context.scene.card?.beats ?? [];
    this.coinedAddresses = findBeatCoinedAddresses(this.beats, run.context.characters);
  }

  public async draft(): Promise<void> {
    const { run } = this;
    const targetLength: number | undefined = skeletonTargetLength(
      run.styleDirective,
      run.tuning.skeletonRatio,
    );
    const base: SkeletonCallInput = {
      narrativeSource: run.narrativeSource,
      ...(run.design.length > 0 ? { design: run.design } : {}),
      personas: run.personasUsed,
      catchphrases: characterCatchphrases(run.context.characters),
      characterKnowledge: run.input.characterKnowledge,
      speechToOthers: characterSpeechToOthers(run.context.characters),
      background: run.background,
      backgroundConflicts: run.backgroundFactConflicts.map(formatBackgroundFactConflict),
      previousContext: buildSkeletonContext(run.condensedPreviousContext, run.input.canonFactLines),
      grounding: run.context.scene.frontmatter.grounding,
      ...(targetLength === undefined ? {} : { targetLength }),
      ...(run.breakPlan === undefined ? {} : { plannedBreaks: true }),
    };
    const options: GenerateTextOptions = withAttribution(
      {
        ...buildGenerateOptions(run.providers, 'sceneSkeleton'),
        styleDirective: run.styleDirective,
      },
      { primary: run.sceneRef },
    );
    const calls: SkeletonCall[] | undefined =
      run.breakPlan === undefined
        ? undefined
        : planSkeletonCalls(run.breakPlan, targetLength, run.tuning.skeletonCharsPerCall);

    const skeleton: CombinedSkeletonDraft =
      calls === undefined || calls.length === 1 || targetLength === undefined
        ? await this.draftInOneCall(base, options)
        : await this.draftInCalls({
            base,
            options,
            calls,
            plan: run.breakPlan as SceneBreakPlan,
            targetLength,
          });
    run.warnings.push(...skeleton.warnings);
    this.adopt(skeleton.text);
  }

  private async draftInOneCall(
    base: SkeletonCallInput,
    options: GenerateTextOptions,
  ): Promise<CombinedSkeletonDraft> {
    const { run, beats } = this;
    const endState: string | undefined = run.context.scene.card?.endState;
    const everyBeat: number[] = beats.map((_, beatIndex) => beatIndex);

    run.onProgress?.('draftSkeleton', 1, 1);
    const whole: SkeletonDraft = await this.draftWithRetries(
      {
        ...this.withAddressCoinage(base, everyBeat),
        ...(endState === undefined ? {} : { endState }),
      },
      options,
      beats.map((beat) => beatText(beat) ?? ''),
    );

    return {
      text: whole.text,
      warnings: whole.violations.map((violation) => ({
        message: `${skeletonWarningLabel('뼈대', whole.retries)}: ${violation.detail}`,
        kinds: [violation.kind],
      })),
    };
  }

  private async draftInCalls(batch: SkeletonCallBatch): Promise<CombinedSkeletonDraft> {
    const { run, beats } = this;
    const { base, options, calls, plan, targetLength } = batch;
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

      const skeletonDraft: SkeletonDraft = await this.draftWithRetries(
        {
          ...this.withAddressCoinage(base, call.beats),
          narrativeSource: renderPlannedNarrative(beats, plan, castName, call.beats),
          targetLength: Math.round((targetLength * call.beats.length) / totalBeats),
          ...(parts.length > 0 ? { priorSkeleton: parts.join('\n\n') } : {}),
          ...(nextBeat === undefined ? {} : { nextBeat }),
          ...(next === undefined && endState !== undefined ? { endState } : {}),
        },
        options,
        call.beats.map((beat) => beatText(beats[beat]) ?? ''),
        call.markers,
        { sectionIndex: index + 1, beatIds: call.beats.map((beat) => String(beat + 1)) },
      );
      parts.push(skeletonDraft.text);
      drafts.push(skeletonDraft);
      assertNotCancelled(run.shouldCancel);
    }

    const text: string = parts.join('\n\n');
    const reported: string[] = drafts.flatMap((draft) => draft.missingBeats);
    const stillMissing: Set<string> = new Set(
      reported.length === 0 ? [] : await this.findMissingBeats(reported, text, options),
    );
    if (reported.length > 0) {
      run.report({
        kind: 'beats-checked',
        beats: reported.flatMap((reportedText) => {
          const beatIndex: number = beats.findIndex((beat) => beatText(beat) === reportedText);
          const status: TraceBeatStatus = stillMissing.has(reportedText) ? 'missing' : 'present';
          return beatIndex === -1 ? [] : [{ number: beatIndex + 1, text: reportedText, status }];
        }),
      });
    }
    return { text, warnings: this.describeCallWarnings(drafts, stillMissing) };
  }

  private describeCallWarnings(
    drafts: readonly SkeletonDraft[],
    stillMissing: ReadonlySet<string>,
  ): SceneWarning[] {
    return drafts.flatMap((draft, index) => {
      const sectionNumber: number = index + 1;
      const label: string = skeletonWarningLabel(`뼈대 ${sectionNumber}/${drafts.length}`, draft.retries);
      const kept: SectionViolation[] = [
        ...draft.violations.filter((violation) => violation.kind !== 'missing-beats'),
        ...missingBeatsViolation(draft.missingBeats.filter((beat) => stillMissing.has(beat))),
      ];
      return kept.map((violation) => ({
        message: `${label}: ${violation.detail}`,
        kinds: [violation.kind],
        sectionNumber,
      }));
    });
  }

  private async draftWithRetries(
    input: SkeletonCallInput,
    options: GenerateTextOptions,
    coverageBeats: readonly string[],
    segmentNumbers?: readonly number[],
    partTag: TraceCallTag = {},
  ): Promise<SkeletonDraft> {
    const tally: SkeletonRetryTally = new SkeletonRetryTally();

    for (let attempt: number = 0; attempt <= this.run.tuning.skeletonRetryLimit; attempt += 1) {
      tally.startAttempt(attempt);
      const attemptInput: SkeletonCallInput = tally.addRetryReasons(input);
      const retryReasons: readonly string[] = attemptInput.retryReasons ?? [];
      const checked: CheckedSkeleton = await this.draftCheckedSkeleton(
        attemptInput,
        {
          ...options,
          traceTag: {
            ...partTag,
            attempt: attempt + 1,
            ...(retryReasons.length === 0 ? {} : { retryReason: retryReasons.join(' / ') }),
          },
        },
        coverageBeats,
        segmentNumbers,
      );

      if (checked.violations.length === 0) {
        return tally.toAcceptedDraft(checked.text);
      }

      tally.recordRejected(
        this.rankSkeleton(checked, input.targetLength),
        this.buildRetryReasons(checked),
      );
    }

    return tally.toBestDraft();
  }

  private async draftCheckedSkeleton(
    input: SkeletonCallInput,
    options: GenerateTextOptions,
    coverageBeats: readonly string[],
    segmentNumbers: readonly number[] | undefined,
  ): Promise<CheckedSkeleton> {
    const { tuning, breakPlan } = this.run;
    const rawResponse: string = await this.run.aiService.draftSceneSkeleton(input, options);
    const skeleton: string = keepSegmentMarkers(curlDialogueQuotes(rawResponse), segmentNumbers);
    const coverage: SkeletonCoverageGaps = await this.findCoverageGaps(
      coverageBeats,
      skeleton,
      options,
    );
    const missingBeats: readonly string[] = coverage.missingBeats;
    this.reportCheckedBeats(coverageBeats, coverage, options.traceTag ?? {});
    const violations: SectionViolation[] = [
      ...validateSceneSkeleton(skeleton, input.targetLength, tuning),
      ...findSeamRepeatViolations({
        previousText: input.priorSkeleton,
        text: skeleton,
        characters: this.run.context.characters,
        tuning,
      }),
      ...validatePlannedSceneBreaks(skeleton, breakPlan, segmentNumbers),
      ...missingBeatsViolation(missingBeats),
      ...reversedBeatsViolation(coverage.reversedBeats),
      ...earlyAddressViolation(
        findWithheldAddressTermsUsed(skeleton, input.withheldAddressTerms ?? []),
      ),
    ];

    return { text: skeleton, violations, missingBeats };
  }

  private withAddressCoinage(
    input: SkeletonCallInput,
    callBeats: readonly number[],
  ): SkeletonCallInput {
    const lastBeat: number = Math.max(...callBeats);
    const withheldTerms: string[] = listAddressTermsCoinedAfter(this.coinedAddresses, lastBeat);
    const coinedNotes: string[] = this.coinedAddresses
      .filter((entry) => callBeats.includes(entry.beatIndex))
      .map((entry) => `«${entry.term}»: «${beatText(this.beats[entry.beatIndex]) ?? ''}»에서 처음 붙는다`);

    return {
      ...input,
      ...(withheldTerms.length === 0
        ? {}
        : {
            withheldAddressTerms: withheldTerms,
            catchphrases: withholdCatchphrases(input.catchphrases ?? new Map(), withheldTerms),
          }),
      ...(coinedNotes.length === 0 ? {} : { coinedAddressNotes: coinedNotes }),
    };
  }

  private reportCheckedBeats(
    beats: readonly string[],
    coverage: SkeletonCoverageGaps,
    tag: TraceCallTag,
  ): void {
    if (beats.length === 0) {
      return;
    }

    const statusOf = (text: string): TraceBeatStatus =>
      coverage.missingBeats.includes(text) ? 'missing' : coverage.reversedBeats.includes(text) ? 'reversed' : 'present';
    this.run.report({
      kind: 'beats-checked',
      ...(tag.sectionIndex === undefined ? {} : { sectionIndex: tag.sectionIndex }),
      ...(tag.attempt === undefined ? {} : { attempt: tag.attempt }),
      beats: beats.map((text, index) => ({
        number: Number(tag.beatIds?.[index] ?? index + 1),
        text,
        status: statusOf(text),
      })),
    });
  }

  private rankSkeleton(
    checked: CheckedSkeleton,
    targetLength: number | undefined,
  ): BestSkeletonAttempt {
    const weight: number = weighViolations(checked.violations, this.run.tuning.violationWeights);
    const distance: number =
      targetLength === undefined ? 0 : Math.abs(checked.text.length - targetLength);

    return { ...checked, weight, distance };
  }

  private buildRetryReasons(checked: CheckedSkeleton): string[] {
    const { tuning, breakPlan } = this.run;

    return [
      ...checked.violations.map((violation) => violation.detail),
      ...thinDialogueReasons(checked.text, checked.violations, breakPlan, this.beats, tuning),
    ];
  }

  private async findMissingBeats(
    beats: readonly string[],
    skeleton: string,
    options: GenerateTextOptions,
  ): Promise<string[]> {
    const coverage: SkeletonCoverageGaps = await this.findCoverageGaps(beats, skeleton, options);
    return [...coverage.missingBeats];
  }

  private async findCoverageGaps(
    beats: readonly string[],
    skeleton: string,
    options: GenerateTextOptions,
  ): Promise<SkeletonCoverageGaps> {
    if (beats.length === 0) {
      return { missingBeats: [], reversedBeats: [] };
    }

    const issues: SceneCoverageIssue[] = await this.run.aiService.checkSceneCoverage(
      beats,
      skeleton,
      options,
    );
    const beatsWithStatus = (status: CoverageStatus): string[] =>
      issues
        .filter((issue) => issue.status === status)
        .map((issue) => beats[issue.index - 1])
        .filter((beat): beat is string => beat !== undefined);

    return { missingBeats: beatsWithStatus('missing'), reversedBeats: beatsWithStatus('reversed') };
  }

  public adopt(skeletonText: string): void {
    const { run } = this;
    const applied: PlannedBreakResult | undefined =
      run.breakPlan === undefined
        ? undefined
        : applyPlannedSceneBreaks(skeletonText, run.breakPlan);
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
        run.warnings.push({
          message: `뼈대: 장면 표식이 ${missingCoordinates}곳 빠져 비트의 좌표를 대신 씁니다.`,
        });
      }
    }
    run.polishedText = run.skeleton;
  }
}
