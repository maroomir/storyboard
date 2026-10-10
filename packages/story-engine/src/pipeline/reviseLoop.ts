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
  DraftCritiqueIssue,
  StyleDirective,
  UsageAttribution,
} from '@storyboard/story-model';

import {
  validateDraftCandidate,
  type DraftCandidateRejectionReason,
} from './draftCandidateValidation';
import {
  adaptContinuityIssues,
  adaptCritiqueIssues,
  buildScopedInstructions,
  routeReviewIssues,
  type RoutingCharacter,
} from './reviewRouting';
import {
  joinDraftSections,
  locateQuoteSection,
  replaceSectionText,
  splitDraftSections,
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
  readonly ctx: ReviseLoopContext;
  readonly body: string;
  readonly maxIterations: number;
  readonly reviseScoreThreshold: number;
  readonly maxCompressionPercent: number;
  readonly onProgress?: (message: string) => void;
  readonly shouldCancel?: () => boolean;
  // Issues found somewhere other than this draft — the final review reads the whole assembled
  // volume, so a long-range contradiction it spots is invisible to a per-scene check. They join the
  // first iteration's own findings and are dropped afterwards, once the rewrite has answered them.
  readonly seedIssues?: ReviseSeedIssues;
}

// A provider that fails mid-review (a timeout on a long rewrite, a dropped connection) ends the loop
// but is not the caller's failure: the draft the loop was handed is already on disk.
export interface ReviseLoopFailure {
  readonly stage: 'check' | 'revise';
  readonly kind: 'timeout' | 'provider';
  readonly message: string;
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
  const reviewIssues = [
    ...adaptContinuityIssues(continuityIssues),
    ...adaptCritiqueIssues(critiqueIssues, characters),
  ];
  const routing = routeReviewIssues(reviewIssues);
  const cardNameById = new Map(
    characters.map((character) => [character.id, character.name] as const),
  );

  const scoped = routing.groups.flatMap((group) =>
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

// Each issue goes to the section its quote came from. An issue that quotes nothing cannot be placed,
// so it rides with every section — rare, since both review prompts ask for the quoted text.
export function planSectionRevisions(
  body: string,
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[],
  characters: readonly ReviseLoopCharacter[],
): SectionRevisionPlan[] {
  const { sections } = splitDraftSections(body);
  const continuityBySection = sections.map((): ContinuityIssueLike[] => []);
  const critiqueBySection = sections.map((): DraftCritiqueIssue[] => []);

  const assign = <T>(buckets: T[][], issue: T, quote: string | undefined): void => {
    const index = locateQuoteSection(sections, quote);
    for (const [bucketIndex, bucket] of buckets.entries()) {
      if (index === undefined || index === bucketIndex) {
        bucket.push(issue);
      }
    }
  };

  continuityIssues.forEach((issue) => assign(continuityBySection, issue, issue.original));
  critiqueIssues.forEach((issue) => assign(critiqueBySection, issue, issue.excerpt));

  return sections.flatMap((_, section) => {
    const sectionContinuity = continuityBySection[section] ?? [];
    const sectionCritique = critiqueBySection[section] ?? [];

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
  readonly ctx: ReviseLoopContext;
}

async function runReviewChecks(
  session: ReviseSession,
  body: string,
): Promise<{
  continuityIssues: Awaited<ReturnType<StoryboardAiService['checkContinuity']>>;
  critiqueIssues: Awaited<ReturnType<StoryboardAiService['critiqueDraft']>>;
}> {
  const { aiService, registry, attribution, ctx } = session;

  const [continuityIssues, critiqueIssues] = await Promise.all([
    aiService.checkContinuity(body, ctx.factLines, {
      providerId: registry.getTaskProvider('continuityCheck'),
      attribution,
    }),
    aiService.critiqueDraft(
      {
        body,
        intent: ctx.intent,
        characters: ctx.characterNames,
        characterCards: ctx.characterCards,
        facts: ctx.factLines,
        styleConstraints: ctx.styleConstraints,
        qualityCriteria: ctx.qualityCriteria,
        styleDirective: ctx.styleDirective,
      },
      { providerId: registry.getTaskProvider('draftCritique'), attribution },
    ),
  ]);

  return { continuityIssues, critiqueIssues };
}

function evaluateReviewResult(
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[],
  threshold: number,
): { blocking: number; instructions: string[]; passed: boolean } {
  const blocking = countBlockingIssues(continuityIssues, critiqueIssues);
  const instructions = buildRevisionInstructions(continuityIssues, critiqueIssues);
  const score = scoreCritique(critiqueIssues);
  const highContinuityCount = continuityIssues.filter((issue) => issue.severity === 'high').length;

  const passed = shouldPassRevise({
    blocking,
    score: score.overall,
    threshold,
    highContinuityCount,
  });

  return { blocking, instructions, passed };
}

interface SectionRejection {
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

// A rejected section keeps its original text and the others still land: one bad candidate no longer
// costs the whole round. Each section is held to its share of the scene's target length.
async function applySectionRevisions(
  session: ReviseSession,
  plans: readonly SectionRevisionPlan[],
  currentBody: string,
  isCancelled: () => boolean,
  maxCompressionPercent: number,
  onSection?: (done: number, total: number) => void,
): Promise<SectionRevisionOutcome> {
  const { aiService, registry, attribution, ctx } = session;
  const split = splitDraftSections(currentBody);
  const sections = [...split.sections];
  const acceptedSections: number[] = [];
  const rejectedSections: SectionRejection[] = [];
  let failure: ReviseLoopFailure | undefined;

  for (const [done, plan] of plans.entries()) {
    if (isCancelled()) {
      break;
    }

    onSection?.(done + 1, plans.length);

    const original = sections[plan.section] ?? '';
    const originalText = original.trim();
    let candidate: string;
    try {
      candidate = await aiService.reviseDraft(
        {
          body: originalText,
          format: ctx.format,
          instructions: plan.instructions,
          intent: ctx.intent,
          facts: ctx.factLines,
          characterCards: ctx.characterCards,
        },
        { providerId: registry.getTaskProvider('draftRevision'), attribution },
      );
    } catch (error) {
      failure = toReviseLoopFailure('revise', error);
      break;
    }
    const sectionTarget =
      ctx.targetLength === undefined || currentBody.length === 0
        ? undefined
        : Math.round((ctx.targetLength * originalText.length) / currentBody.length);
    const validation = validateDraftCandidate(originalText, candidate, {
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

// NOTE: Both apps share this exact review→revise policy; changing pass/stop semantics here changes
// the extension's revise command and the CLI's `draft revise` together.
export async function runReviseLoop(options: ReviseLoopOptions): Promise<ReviseLoopResult> {
  const { aiService, registry, attribution, ctx, maxIterations, reviseScoreThreshold } = options;
  const isCancelled = (): boolean => options.shouldCancel?.() ?? false;
  const session: ReviseSession = { aiService, registry, attribution, ctx };

  let body = options.body;
  let revisionCount = 0;
  let blocking = 0;
  let passed = false;
  let lastInstructions: string[] = [];
  let rejection: ReviseLoopResult['rejection'];
  let failure: ReviseLoopFailure | undefined;

  while (!isCancelled()) {
    options.onProgress?.(`검사 중 (${revisionCount + 1}/${maxIterations + 1})…`);

    let checked: Awaited<ReturnType<typeof runReviewChecks>>;
    try {
      checked = await runReviewChecks(session, body);
    } catch (error) {
      failure = toReviseLoopFailure('check', error);
      break;
    }

    const seed = revisionCount === 0 ? options.seedIssues : undefined;
    const continuityIssues = [...checked.continuityIssues, ...(seed?.continuityIssues ?? [])];
    const critiqueIssues = [...checked.critiqueIssues, ...(seed?.critiqueIssues ?? [])];
    const review = evaluateReviewResult(continuityIssues, critiqueIssues, reviseScoreThreshold);
    blocking = review.blocking;
    lastInstructions = review.instructions;

    if (review.passed) {
      passed = true;
      break;
    }

    if (revisionCount >= maxIterations || isCancelled()) {
      break;
    }

    const round = revisionCount + 1;
    options.onProgress?.(`재작성 중 (${round}/${maxIterations})…`);

    const plans = planSectionRevisions(body, continuityIssues, critiqueIssues, ctx.characters);
    if (plans.length === 0) {
      break;
    }

    const applied = await applySectionRevisions(
      session,
      plans,
      body,
      isCancelled,
      options.maxCompressionPercent,
      (done, total) =>
        options.onProgress?.(`재작성 중 (${round}/${maxIterations}) · 구간 ${done}/${total}…`),
    );
    failure = applied.failure;

    if (applied.acceptedSections.length === 0) {
      if (applied.rejectedSections.length > 0 && failure === undefined) {
        rejection = summarizeRejection(applied.rejectedSections);
      }
      break;
    }

    // Sections accepted before a provider failure are kept: they passed the same checks.
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
  };
}
