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

interface ReviseSession {
  readonly aiService: StoryboardAiService;
  readonly registry: AiProviderRegistry;
  readonly attribution: UsageAttribution;
  readonly loopContext: ReviseLoopContext;
}

interface ReviewCheckResults {
  continuityIssues: Awaited<ReturnType<StoryboardAiService['checkContinuity']>>;
  critiqueIssues: Awaited<ReturnType<StoryboardAiService['critiqueDraft']>>;
}

async function runReviewChecks(session: ReviseSession, body: string): Promise<ReviewCheckResults> {
  const { aiService, registry, attribution, loopContext } = session;

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

async function applySectionRevisions(
  session: ReviseSession,
  plans: readonly SectionRevisionPlan[],
  currentBody: string,
  isCancelled: () => boolean,
  maxCompressionPercent: number,
  onSection?: (done: number, total: number) => void,
): Promise<SectionRevisionOutcome> {
  const { aiService, registry, attribution, loopContext } = session;
  const split: DraftSections = splitDraftSections(currentBody);
  const sections: string[] = [...split.sections];
  const acceptedSections: number[] = [];
  const rejectedSections: SectionRejection[] = [];
  let failure: ReviseLoopFailure | undefined;

  for (const [done, plan] of plans.entries()) {
    if (isCancelled()) {
      break;
    }

    onSection?.(done + 1, plans.length);

    const original: string = sections[plan.section] ?? '';
    const originalText: string = original.trim();
    let candidate: string;
    try {
      candidate = await aiService.reviseDraft(
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
    } catch (error) {
      failure = toReviseLoopFailure('revise', error);
      break;
    }
    const sectionTarget: number | undefined =
      loopContext.targetLength === undefined || currentBody.length === 0
        ? undefined
        : Math.round((loopContext.targetLength * originalText.length) / currentBody.length);
    const validation: DraftCandidateValidation = validateDraftCandidate(originalText, candidate, {
      maxCompressionPercent,
      ...(sectionTarget === undefined ? {} : { targetLength: sectionTarget }),
    });

    if (!validation.accepted) {
      rejectedSections.push({
        section: plan.section,
        reason: validation.reason ?? 'empty',
        originalLength: originalText.length,
        candidateLength: validation.candidateLength,
      });
      continue;
    }

    sections[plan.section] = replaceSectionText(original, candidate);
    acceptedSections.push(plan.section);
  }

  return {
    body: joinDraftSections({ sections, breakLines: split.breakLines }),
    acceptedSections,
    rejectedSections,
    ...(failure === undefined ? {} : { failure }),
  };
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

export async function runReviseLoop(options: ReviseLoopOptions): Promise<ReviseLoopResult> {
  const { aiService, registry, attribution, loopContext, maxIterations, reviseScoreThreshold } =
    options;
  const isCancelled = (): boolean => options.shouldCancel?.() ?? false;
  const session: ReviseSession = { aiService, registry, attribution, loopContext };

  let body: string = options.body;
  let revisionCount: number = 0;
  let blocking: number = 0;
  let passed: boolean = false;
  let lastInstructions: string[] = [];
  let rejection: ReviseLoopResult['rejection'];
  let failure: ReviseLoopFailure | undefined;
  const rounds: ReviseRound[] = [];
  const endRound = (round: ReviseRound): void => {
    rounds.push(round);
    options.onRound?.(round);
  };

  while (!isCancelled()) {
    const round: number = revisionCount + 1;
    options.onProgress?.(`검사 중 (${round}/${maxIterations + 1})…`);

    let checked: Awaited<ReturnType<typeof runReviewChecks>>;
    try {
      checked = await runReviewChecks(session, body);
    } catch (error) {
      failure = toReviseLoopFailure('check', error);
      endRound({
        round,
        continuityIssues: [],
        critiqueIssues: [],
        blocking,
        passed: false,
        instructions: [],
        failure,
      });
      break;
    }

    const seed: ReviseSeedIssues | undefined = revisionCount === 0 ? options.seedIssues : undefined;
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
      reviseScoreThreshold,
    );
    blocking = review.blocking;
    lastInstructions = review.instructions;
    const checkedRound: ReviseRound = {
      round,
      continuityIssues,
      critiqueIssues,
      blocking: review.blocking,
      passed: review.passed,
      instructions: review.instructions,
    };

    if (review.passed) {
      passed = true;
      endRound(checkedRound);
      break;
    }

    if (revisionCount >= maxIterations || isCancelled()) {
      endRound(checkedRound);
      break;
    }

    options.onProgress?.(`재작성 중 (${round}/${maxIterations})…`);

    const plans: SectionRevisionPlan[] = planSectionRevisions(
      body,
      continuityIssues,
      critiqueIssues,
      loopContext.characters,
    );
    if (plans.length === 0) {
      endRound(checkedRound);
      break;
    }

    const applied: SectionRevisionOutcome = await applySectionRevisions(
      session,
      plans,
      body,
      isCancelled,
      options.maxCompressionPercent,
      (done, total) =>
        options.onProgress?.(`재작성 중 (${round}/${maxIterations}) · 구간 ${done}/${total}…`),
    );
    failure = applied.failure;
    endRound({
      ...checkedRound,
      rewrite: {
        plannedSections: plans.map((plan) => plan.section),
        acceptedSections: applied.acceptedSections,
        rejectedSections: applied.rejectedSections,
      },
      ...(failure === undefined ? {} : { failure }),
    });

    if (applied.acceptedSections.length === 0) {
      if (applied.rejectedSections.length > 0 && failure === undefined) {
        rejection = summarizeRejection(applied.rejectedSections);
      }
      break;
    }

    body = applied.body;
    revisionCount += 1;

    if (failure) {
      break;
    }
  }

  return {
    body,
    passed,
    revisionCount,
    remainingBlocking: blocking,
    cancelled: isCancelled(),
    instructions: lastInstructions,
    preservedOriginal: rejection !== undefined,
    rejection,
    ...(failure === undefined ? {} : { failure }),
    rounds,
  };
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
