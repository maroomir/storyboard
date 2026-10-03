import {
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
}

function buildRevisionPasses(
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[],
  characters: readonly ReviseLoopCharacter[],
  globalInstructions: readonly string[],
): readonly (readonly string[])[] {
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

  return [[...scoped, ...(routing.global.length > 0 ? globalInstructions : [])]];
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

async function applyRevisionPasses(
  session: ReviseSession,
  revisionPasses: readonly (readonly string[])[],
  currentBody: string,
  isCancelled: () => boolean,
  maxCompressionPercent: number,
): Promise<
  | { body: string; appliedAnyPass: boolean; rejection?: undefined }
  | {
      body: string;
      appliedAnyPass: false;
      rejection: {
        readonly reason: DraftCandidateRejectionReason;
        readonly candidateLength: number;
        readonly originalLength: number;
      };
    }
> {
  const { aiService, registry, attribution, ctx } = session;

  let body = currentBody;
  let appliedAnyPass = false;

  for (const instructions of revisionPasses) {
    if (isCancelled()) {
      break;
    }

    const candidate = await aiService.reviseDraft(
      {
        body,
        format: ctx.format,
        instructions,
        intent: ctx.intent,
        facts: ctx.factLines,
        characterCards: ctx.characterCards,
      },
      { providerId: registry.getTaskProvider('draftRevision'), attribution },
    );
    const validation = validateDraftCandidate(currentBody, candidate, {
      maxCompressionPercent,
      targetLength: ctx.targetLength,
    });

    if (!validation.accepted) {
      return {
        body: currentBody,
        appliedAnyPass: false,
        rejection: {
          reason: validation.reason ?? 'empty',
          candidateLength: validation.candidateLength,
          originalLength: currentBody.length,
        },
      };
    }

    body = candidate;
    appliedAnyPass = true;
  }

  return { body, appliedAnyPass };
}

// NOTE: Both apps share this exact review→revise policy; changing pass/stop semantics here changes
// the extension's revise command and the CLI's `scene revise` together.
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

  while (!isCancelled()) {
    options.onProgress?.(`검사 중 (${revisionCount + 1}/${maxIterations + 1})…`);

    const checked = await runReviewChecks(session, body);
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

    options.onProgress?.(`재작성 중 (${revisionCount + 1}/${maxIterations})…`);

    const revisionPasses = buildRevisionPasses(
      continuityIssues,
      critiqueIssues,
      ctx.characters,
      lastInstructions,
    );
    const applied = await applyRevisionPasses(
      session,
      revisionPasses,
      body,
      isCancelled,
      options.maxCompressionPercent,
    );
    body = applied.body;

    if (applied.rejection) {
      rejection = applied.rejection;
      break;
    }

    if (!applied.appliedAnyPass) {
      break;
    }

    revisionCount += 1;
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
  };
}
