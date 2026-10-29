import {
  AiProviderError,
  buildRevisionInstructions,
  countBlockingIssues,
  scoreCritique,
  shouldPassRevise,
} from '@storyboard/story-model';
import type {
  AiProviderRegistry,
  DraftRevisionInput,
  StoryboardAiService,
} from '@storyboard/story-ai';
import type {
  ContinuityIssueLike,
  CritiqueScore,
  DraftCritiqueIssue,
  StyleDirective,
  UsageAttribution,
} from '@storyboard/story-model';

import {
  validateDraftCandidate,
  type DraftCandidateRejectionReason,
  type DraftCandidateValidation,
} from './draftCandidateValidation';
import {
  adaptContinuityIssues,
  adaptCritiqueIssues,
  buildScopedInstructions,
  routeReviewIssues,
  type ReviewIssue,
  type ReviewRouting,
  type RoutingCharacter,
} from './reviewRouting';
import {
  joinDraftSections,
  locateQuoteSection,
  replaceSectionText,
  splitDraftSections,
  type DraftSections,
} from './revisionSections';

export interface ReviseLoopCharacter extends RoutingCharacter {
  readonly name: string;
}

export interface ReviseLoopContext {
  readonly format: DraftRevisionInput['format'];
  readonly intent: string;
  readonly factLines: readonly string[];
  readonly characterNames: readonly string[];
  readonly characterCards: readonly string[];
  readonly styleConstraints: readonly string[];
  readonly qualityCriteria: readonly string[];
  readonly styleDirective: StyleDirective | undefined;
  readonly characters: readonly ReviseLoopCharacter[];
  readonly targetLength?: number;
}

export interface ReviseSeedIssues {
  readonly continuityIssues: readonly ContinuityIssueLike[];
  readonly critiqueIssues: readonly DraftCritiqueIssue[];
}

export interface ReviseLoopOptions {
  readonly aiService: StoryboardAiService;
  readonly registry: AiProviderRegistry;
  readonly attribution: UsageAttribution;
  readonly loopContext: ReviseLoopContext;
  readonly body: string;
  readonly maxIterations: number;
  readonly reviseScoreThreshold: number;
  readonly maxCompressionPercent: number;
  readonly onProgress?: (message: string) => void;
  readonly shouldCancel?: () => boolean;
  readonly seedIssues?: ReviseSeedIssues;
  readonly onRound?: (round: ReviseRound) => void;
}

export interface ReviseLoopFailure {
  readonly stage: 'check' | 'revise';
  readonly kind: 'timeout' | 'provider';
  readonly message: string;
}

export interface ReviseRound {
  readonly round: number;
  readonly continuityIssues: readonly ContinuityIssueLike[];
  readonly critiqueIssues: readonly DraftCritiqueIssue[];
  readonly blocking: number;
  readonly passed: boolean;
  readonly instructions: readonly string[];
  readonly rewrite?: {
    readonly plannedSections: readonly number[];
    readonly acceptedSections: readonly number[];
    readonly rejectedSections: readonly SectionRejection[];
  };
  readonly failure?: ReviseLoopFailure;
}

export interface ReviseLoopResult {
  readonly body: string;
  readonly passed: boolean;
  readonly revisionCount: number;
  readonly remainingBlocking: number;
  readonly cancelled: boolean;
  readonly instructions: readonly string[];
  readonly preservedOriginal: boolean;
  readonly rejection?: {
    readonly reason: DraftCandidateRejectionReason;
    readonly originalLength: number;
    readonly candidateLength: number;
  };
  readonly failure?: ReviseLoopFailure;
  readonly rounds: readonly ReviseRound[];
}

function toReviseLoopFailure(stage: ReviseLoopFailure['stage'], error: unknown): ReviseLoopFailure {
  if (!(error instanceof AiProviderError)) {
    throw error;
  }

  return {
    stage,
    kind: error.code === 'cli-timeout' ? 'timeout' : 'provider',
    message: error.message,
  };
}

function buildSectionInstructions(
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[],
  characters: readonly ReviseLoopCharacter[],
): string[] {
  const reviewIssues: ReviewIssue[] = [
    ...adaptContinuityIssues(continuityIssues),
    ...adaptCritiqueIssues(critiqueIssues, characters),
  ];
  const routing: ReviewRouting = routeReviewIssues(reviewIssues);
  const cardNameById: Map<string, string> = new Map(
    characters.map((character) => [character.id, character.name] as const),
  );

  const scoped: string[] = routing.groups.flatMap((group) =>
    buildScopedInstructions(group, (cardId) => cardNameById.get(cardId)),
  );

  return [
    ...scoped,
    ...(routing.global.length > 0
      ? buildRevisionInstructions(continuityIssues, critiqueIssues)
      : []),
  ];
}

export interface SectionRevisionPlan {
  readonly section: number;
  readonly instructions: readonly string[];
}

export function planSectionRevisions(
  body: string,
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[],
  characters: readonly ReviseLoopCharacter[],
): SectionRevisionPlan[] {
  const { sections } = splitDraftSections(body);
  const continuityBySection: ContinuityIssueLike[][] = sections.map(
    (): ContinuityIssueLike[] => [],
  );
  const critiqueBySection: DraftCritiqueIssue[][] = sections.map((): DraftCritiqueIssue[] => []);

  const assign = <T>(buckets: T[][], issue: T, quote: string | undefined): void => {
    const index: number | undefined = locateQuoteSection(sections, quote);
    for (const [bucketIndex, bucket] of buckets.entries()) {
      if (index === undefined || index === bucketIndex) {
        bucket.push(issue);
      }
    }
  };

  continuityIssues.forEach((issue) => assign(continuityBySection, issue, issue.original));
  critiqueIssues.forEach((issue) => assign(critiqueBySection, issue, issue.excerpt));

  return sections.flatMap((_, section) => {
    const sectionContinuity: ContinuityIssueLike[] = continuityBySection[section] ?? [];
    const sectionCritique: DraftCritiqueIssue[] = critiqueBySection[section] ?? [];

    if (sectionContinuity.length === 0 && sectionCritique.length === 0) {
      return [];
    }

    return [
      {
        section,
        instructions: buildSectionInstructions(sectionContinuity, sectionCritique, characters),
      },
    ];
  });
}

interface ReviewCheckResults {
  continuityIssues: Awaited<ReturnType<StoryboardAiService['checkContinuity']>>;
  critiqueIssues: Awaited<ReturnType<StoryboardAiService['critiqueDraft']>>;
}

interface ReviewEvaluation {
  blocking: number;
  instructions: string[];
  passed: boolean;
}

function evaluateReviewResult(
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[],
  threshold: number,
): ReviewEvaluation {
  const blocking: number = countBlockingIssues(continuityIssues, critiqueIssues);
  const instructions: string[] = buildRevisionInstructions(continuityIssues, critiqueIssues);
  const score: CritiqueScore = scoreCritique(critiqueIssues);
  const highContinuityCount: number = continuityIssues.filter(
    (issue) => issue.severity === 'high',
  ).length;

  const passed: boolean = shouldPassRevise({
    blocking,
    score: score.overall,
    threshold,
    highContinuityCount,
  });

  return { blocking, instructions, passed };
}

export interface SectionRejection {
  readonly section: number;
  readonly reason: DraftCandidateRejectionReason;
  readonly originalLength: number;
  readonly candidateLength: number;
}

interface SectionRevisionOutcome {
  readonly body: string;
  readonly acceptedSections: readonly number[];
  readonly rejectedSections: readonly SectionRejection[];
  readonly failure?: ReviseLoopFailure;
}

function summarizeRejection(
  rejected: readonly SectionRejection[],
): NonNullable<ReviseLoopResult['rejection']> {
  return {
    reason: rejected[0]?.reason ?? 'empty',
    originalLength: rejected.reduce((sum, item) => sum + item.originalLength, 0),
    candidateLength: rejected.reduce((sum, item) => sum + item.candidateLength, 0),
  };
}

class ReviseLoopState {
  private body: string;
  private revisionCount: number = 0;
  private blocking: number = 0;
  private passed: boolean = false;
  private lastInstructions: string[] = [];
  private rejection: ReviseLoopResult['rejection'];
  private failure: ReviseLoopFailure | undefined;
  private readonly rounds: ReviseRound[] = [];

  public constructor(private readonly options: ReviseLoopOptions) {
    this.body = options.body;
  }

  public getBody(): string {
    return this.body;
  }

  public getRevisionCount(): number {
    return this.revisionCount;
  }

  public getNextRoundNumber(): number {
    return this.revisionCount + 1;
  }

  public hasFailure(): boolean {
    return this.failure !== undefined;
  }

  public endRound(round: ReviseRound): void {
    this.rounds.push(round);
    this.options.onRound?.(round);
  }

  public recordCheckFailure(round: number, failure: ReviseLoopFailure): void {
    this.failure = failure;
    this.endRound({
      round,
      continuityIssues: [],
      critiqueIssues: [],
      blocking: this.blocking,
      passed: false,
      instructions: [],
      failure,
    });
  }

  public recordReview(review: ReviewEvaluation): void {
    this.blocking = review.blocking;
    this.lastInstructions = review.instructions;
  }

  public markPassed(): void {
    this.passed = true;
  }

  public recordRewrite(
    checkedRound: ReviseRound,
    plans: readonly SectionRevisionPlan[],
    applied: SectionRevisionOutcome,
  ): void {
    this.failure = applied.failure;
    this.endRound({
      ...checkedRound,
      rewrite: {
        plannedSections: plans.map((plan) => plan.section),
        acceptedSections: applied.acceptedSections,
        rejectedSections: applied.rejectedSections,
      },
      ...(this.failure === undefined ? {} : { failure: this.failure }),
    });
  }

  public recordRejectedRewrite(rejectedSections: readonly SectionRejection[]): void {
    if (rejectedSections.length > 0 && this.failure === undefined) {
      this.rejection = summarizeRejection(rejectedSections);
    }
  }

  public acceptRevision(body: string): void {
    this.body = body;
    this.revisionCount += 1;
  }

  public toResult(isCancelled: boolean): ReviseLoopResult {
    return {
      body: this.body,
      passed: this.passed,
      revisionCount: this.revisionCount,
      remainingBlocking: this.blocking,
      cancelled: isCancelled,
      instructions: this.lastInstructions,
      preservedOriginal: this.rejection !== undefined,
      rejection: this.rejection,
      ...(this.failure === undefined ? {} : { failure: this.failure }),
      rounds: this.rounds,
    };
  }
}

class SectionRevisionTally {
  private readonly sections: string[];
  private readonly acceptedSections: number[] = [];
  private readonly rejectedSections: SectionRejection[] = [];
  private failure: ReviseLoopFailure | undefined;

  public constructor(private readonly split: DraftSections) {
    this.sections = [...split.sections];
  }

  public getSection(section: number): string {
    return this.sections[section] ?? '';
  }

  public acceptSection(section: number, text: string): void {
    this.sections[section] = text;
    this.acceptedSections.push(section);
  }

  public addRejection(rejection: SectionRejection): void {
    this.rejectedSections.push(rejection);
  }

  public recordFailure(failure: ReviseLoopFailure): void {
    this.failure = failure;
  }

  public toOutcome(): SectionRevisionOutcome {
    return {
      body: joinDraftSections({ sections: this.sections, breakLines: this.split.breakLines }),
      acceptedSections: this.acceptedSections,
      rejectedSections: this.rejectedSections,
      ...(this.failure === undefined ? {} : { failure: this.failure }),
    };
  }
}

export class ReviseLoop {
  public constructor(private readonly options: ReviseLoopOptions) {}

  public async run(): Promise<ReviseLoopResult> {
    const state: ReviseLoopState = new ReviseLoopState(this.options);

    while (!this.isCancelled()) {
      const shouldContinue: boolean = await this.runRound(state);
      if (!shouldContinue) {
        break;
      }
    }

    return state.toResult(this.isCancelled());
  }

  private isCancelled(): boolean {
    return this.options.shouldCancel?.() ?? false;
  }

  private async runRound(state: ReviseLoopState): Promise<boolean> {
    const round: number = state.getNextRoundNumber();
    this.options.onProgress?.(`검사 중 (${round}/${this.options.maxIterations + 1})…`);

    let checked: ReviewCheckResults;
    try {
      checked = await this.runReviewChecks(state.getBody());
    } catch (error) {
      state.recordCheckFailure(round, toReviseLoopFailure('check', error));
      return false;
    }

    const checkedRound: ReviseRound = this.reviewCheckedDraft(state, round, checked);

    if (checkedRound.passed) {
      state.markPassed();
      state.endRound(checkedRound);
      return false;
    }

    if (state.getRevisionCount() >= this.options.maxIterations || this.isCancelled()) {
      state.endRound(checkedRound);
      return false;
    }

    return this.reviseCheckedDraft(state, checkedRound);
  }

  private reviewCheckedDraft(
    state: ReviseLoopState,
    round: number,
    checked: ReviewCheckResults,
  ): ReviseRound {
    const seed: ReviseSeedIssues | undefined =
      state.getRevisionCount() === 0 ? this.options.seedIssues : undefined;
    const continuityIssues: ContinuityIssueLike[] = [
      ...checked.continuityIssues,
      ...(seed?.continuityIssues ?? []),
    ];
    const critiqueIssues: DraftCritiqueIssue[] = [
      ...checked.critiqueIssues,
      ...(seed?.critiqueIssues ?? []),
    ];
    const review: ReviewEvaluation = evaluateReviewResult(
      continuityIssues,
      critiqueIssues,
      this.options.reviseScoreThreshold,
    );
    state.recordReview(review);

    return {
      round,
      continuityIssues,
      critiqueIssues,
      blocking: review.blocking,
      passed: review.passed,
      instructions: review.instructions,
    };
  }

  private async reviseCheckedDraft(
    state: ReviseLoopState,
    checkedRound: ReviseRound,
  ): Promise<boolean> {
    const { round } = checkedRound;
    const { maxIterations } = this.options;
    this.options.onProgress?.(`재작성 중 (${round}/${maxIterations})…`);

    const plans: SectionRevisionPlan[] = planSectionRevisions(
      state.getBody(),
      checkedRound.continuityIssues,
      checkedRound.critiqueIssues,
      this.options.loopContext.characters,
    );
    if (plans.length === 0) {
      state.endRound(checkedRound);
      return false;
    }

    const applied: SectionRevisionOutcome = await this.applySectionRevisions(
      plans,
      state.getBody(),
      (done, total) =>
        this.options.onProgress?.(`재작성 중 (${round}/${maxIterations}) · 구간 ${done}/${total}…`),
    );
    state.recordRewrite(checkedRound, plans, applied);

    if (applied.acceptedSections.length === 0) {
      state.recordRejectedRewrite(applied.rejectedSections);
      return false;
    }

    state.acceptRevision(applied.body);
    return !state.hasFailure();
  }

  private async runReviewChecks(body: string): Promise<ReviewCheckResults> {
    const { aiService, registry, attribution, loopContext } = this.options;

    const [continuityIssues, critiqueIssues] = await Promise.all([
      aiService.checkContinuity(body, loopContext.factLines, {
        providerId: registry.getTaskProvider('continuityCheck'),
        attribution,
      }),
      aiService.critiqueDraft(
        {
          body,
          intent: loopContext.intent,
          characters: loopContext.characterNames,
          characterCards: loopContext.characterCards,
          facts: loopContext.factLines,
          styleConstraints: loopContext.styleConstraints,
          qualityCriteria: loopContext.qualityCriteria,
          styleDirective: loopContext.styleDirective,
        },
        { providerId: registry.getTaskProvider('draftCritique'), attribution },
      ),
    ]);

    return { continuityIssues, critiqueIssues };
  }

  private async applySectionRevisions(
    plans: readonly SectionRevisionPlan[],
    currentBody: string,
    onSection: (done: number, total: number) => void,
  ): Promise<SectionRevisionOutcome> {
    const tally: SectionRevisionTally = new SectionRevisionTally(splitDraftSections(currentBody));

    for (const [done, plan] of plans.entries()) {
      if (this.isCancelled()) {
        break;
      }

      onSection(done + 1, plans.length);

      const shouldContinue: boolean = await this.reviseSection(plan, currentBody, tally);
      if (!shouldContinue) {
        break;
      }
    }

    return tally.toOutcome();
  }

  private async reviseSection(
    plan: SectionRevisionPlan,
    currentBody: string,
    tally: SectionRevisionTally,
  ): Promise<boolean> {
    const original: string = tally.getSection(plan.section);
    const originalText: string = original.trim();
    let candidate: string;
    try {
      candidate = await this.requestSectionRevision(plan, originalText);
    } catch (error) {
      tally.recordFailure(toReviseLoopFailure('revise', error));
      return false;
    }
    const validation: DraftCandidateValidation = this.validateSectionCandidate(
      originalText,
      candidate,
      currentBody,
    );

    if (!validation.accepted) {
      tally.addRejection({
        section: plan.section,
        reason: validation.reason ?? 'empty',
        originalLength: originalText.length,
        candidateLength: validation.candidateLength,
      });
      return true;
    }

    tally.acceptSection(plan.section, replaceSectionText(original, candidate));
    return true;
  }

  private requestSectionRevision(plan: SectionRevisionPlan, originalText: string): Promise<string> {
    const { aiService, registry, attribution, loopContext } = this.options;

    return aiService.reviseDraft(
      {
        body: originalText,
        format: loopContext.format,
        instructions: plan.instructions,
        intent: loopContext.intent,
        facts: loopContext.factLines,
        characterCards: loopContext.characterCards,
      },
      { providerId: registry.getTaskProvider('draftRevision'), attribution },
    );
  }

  private validateSectionCandidate(
    originalText: string,
    candidate: string,
    currentBody: string,
  ): DraftCandidateValidation {
    const { loopContext, maxCompressionPercent } = this.options;
    const sectionTarget: number | undefined =
      loopContext.targetLength === undefined || currentBody.length === 0
        ? undefined
        : Math.round((loopContext.targetLength * originalText.length) / currentBody.length);

    return validateDraftCandidate(originalText, candidate, {
      maxCompressionPercent,
      ...(sectionTarget === undefined ? {} : { targetLength: sectionTarget }),
    });
  }
}

const rejectionReasonLabels: Record<DraftCandidateRejectionReason, string> = {
  empty: '빈 결과',
  'meta-response': '설명문',
  'too-short': '분량 미달',
  'not-shorter': '줄지 않음',
  'scene-breaks-changed': '장면 구분 변경',
};

export function describeReviseRound(round: ReviseRound): string {
  const highContinuity: number = round.continuityIssues.filter(
    (issue) => issue.severity === 'high',
  ).length;
  const parts: string[] = [
    `검사 ${round.round}: 연속성 ${round.continuityIssues.length}건(높음 ${highContinuity}) · 비평 ${round.critiqueIssues.length}건 · 차단 ${round.blocking}`,
  ];

  if (round.passed) {
    parts.push('통과');
  }

  if (round.rewrite) {
    const { plannedSections, acceptedSections, rejectedSections } = round.rewrite;
    const rejected: string = rejectedSections
      .map(
        (item) =>
          `${item.section + 1}구간 ${rejectionReasonLabels[item.reason]}(${item.candidateLength}/${item.originalLength}자)`,
      )
      .join(', ');
    parts.push(
      `재작성 ${plannedSections.length}구간 중 ${acceptedSections.length}구간 반영${rejected.length > 0 ? `, 기각: ${rejected}` : ''}`,
    );
  }

  if (round.failure) {
    parts.push(`중단: ${round.failure.message}`);
  }

  return parts.join(' → ');
}
