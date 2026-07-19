import type * as vscode from 'vscode';

import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { joinUri, type StoryboardProjectPaths } from '../../infrastructure/vscode/pathConventions';
import {
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
} from '../../domain/sceneContext';
import {
  sceneContextFileSystem,
  sceneContextPaths,
  vscodeFsAdapter,
} from '../../infrastructure/vscode/workspaceFsAdapters';
import { createDraft, parseDraft, readDraftFile, writeDraftFile } from '../../domain/files/draft';
import { readProjectJson } from '../../infrastructure/persistence/projectJson';
import { readSceneFile } from '../../domain/files/scene';
import { StoryboardAIService } from '../../infrastructure/ai/AIService';
import { formatAugmentCards } from '../../infrastructure/ai/prompts/draftAugment';
import type { UsageAttribution } from '../../shared/aiTypes';
import type { AiProviderRegistry } from '../../infrastructure/ai/providerRegistry';
import { recordUsageSafely } from '../../infrastructure/ai/recordUsageSafely';
import type { UsageRecorder } from '../../infrastructure/ai/UsageRecorder';
import {
  buildRevisionInstructions,
  countBlockingIssues,
  scoreCritique,
  shouldPassRevise,
} from '../../shared/draftReview';
import {
  adaptContinuityIssues,
  adaptCritiqueIssues,
  buildScopedInstructions,
  routeReviewIssues,
} from '../../shared/reviewRouting';
import type { ProjectSetting } from '../../shared/project';
import { buildStyleDirective } from '../../shared/styleDirective';
import {
  type DraftCandidateRejectionReason,
  resolveSceneTargetLength,
  validateDraftCandidate,
} from './draftCandidateValidation';

async function readContractGuidance(projectJsonUri: vscode.Uri): Promise<{
  styleConstraints: readonly string[];
  qualityCriteria: readonly string[];
  setting?: ProjectSetting;
}> {
  try {
    const project = await readProjectJson(projectJsonUri);
    return {
      styleConstraints: project.setting?.styleConstraints ?? [],
      qualityCriteria: project.setting?.qualityCriteria ?? [],
      setting: project.setting,
    };
  } catch {
    return { styleConstraints: [], qualityCriteria: [] };
  }
}

export interface ReviseDraftUseCaseDependencies {
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly usageRecorder: UsageRecorder;
  readonly logger: StoryboardLogger;
}

export interface ReviseDraftRequest {
  readonly workspaceUri: vscode.Uri;
  readonly paths: StoryboardProjectPaths;
  readonly draftUri: vscode.Uri;
  readonly sceneStem: string;
  readonly maxIterations: number;
  readonly maxCompressionPercent: number;
  readonly reviseScoreThreshold: number;
  readonly onProgress?: (message: string) => void;
  readonly shouldCancel?: () => boolean;
}

export interface ReviseDraftWorkflowResult {
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

interface ReviseDraftContext {
  readonly context: Awaited<ReturnType<typeof buildSceneContext>>;
  readonly factLines: readonly string[];
  readonly characterNames: readonly string[];
  readonly characterCards: readonly string[];
  readonly intent: string;
  readonly styleConstraints: readonly string[];
  readonly qualityCriteria: readonly string[];
  readonly styleDirective: ReturnType<typeof buildStyleDirective>;
  readonly draft: ReturnType<typeof parseDraft>;
  readonly targetLength?: number;
}

async function prepareReviseDraftContext(
  paths: StoryboardProjectPaths,
  draftUri: vscode.Uri,
  sceneStem: string,
): Promise<ReviseDraftContext> {
  const sceneFileName = `${sceneStem}.txt`;
  const scene = await readSceneFile(
    joinUri(paths.sceneDirectory, sceneFileName),
    vscodeFsAdapter,
    sceneFileName,
  );
  const ctxPaths = sceneContextPaths(paths);
  const context = await buildSceneContext(ctxPaths, scene, sceneContextFileSystem);
  const narrative = await buildNarrativeContext(ctxPaths, context, sceneContextFileSystem);
  const factLines = formatBibleFactLines(context, narrative.bibleFacts);
  const characterNames = context.characters.map((character) => character.name);
  const characterCards = formatAugmentCards(context.characters, undefined);
  const intent = scene.body;
  const { styleConstraints, qualityCriteria, setting } = await readContractGuidance(
    paths.projectJson,
  );
  const styleDirective = buildStyleDirective(
    setting,
    scene.frontmatter.relationStage,
    scene.frontmatter.targetWordCount,
  );

  const draft = parseDraft(await readDraftFile(draftUri, vscodeFsAdapter));

  return {
    context,
    factLines,
    characterNames,
    characterCards,
    intent,
    styleConstraints,
    qualityCriteria,
    styleDirective,
    draft,
    targetLength: resolveSceneTargetLength(scene.frontmatter.targetWordCount, scene.body),
  };
}

function buildRevisionPasses(
  continuityIssues: Awaited<ReturnType<StoryboardAIService['checkContinuity']>>,
  critiqueIssues: Awaited<ReturnType<StoryboardAIService['critiqueDraft']>>,
  characters: ReviseDraftContext['context']['characters'],
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
  readonly aiService: StoryboardAIService;
  readonly registry: AiProviderRegistry;
  readonly attribution: UsageAttribution;
  readonly ctx: ReviseDraftContext;
}

async function runReviewChecks(
  session: ReviseSession,
  body: string,
): Promise<{
  continuityIssues: Awaited<ReturnType<StoryboardAIService['checkContinuity']>>;
  critiqueIssues: Awaited<ReturnType<StoryboardAIService['critiqueDraft']>>;
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
  continuityIssues: Awaited<ReturnType<StoryboardAIService['checkContinuity']>>,
  critiqueIssues: Awaited<ReturnType<StoryboardAIService['critiqueDraft']>>,
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
        format: ctx.draft.format,
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

async function runReviseDraftWorkflow(
  options: ReviseDraftUseCaseDependencies & ReviseDraftRequest,
): Promise<ReviseDraftWorkflowResult> {
  const { paths, draftUri, sceneStem, maxIterations, reviseScoreThreshold, maxCompressionPercent } =
    options;
  const registry = options.aiProviderRegistry;
  const isCancelled = (): boolean => options.shouldCancel?.() ?? false;

  const aiService = new StoryboardAIService(registry, {
    onUsage: (record): void => {
      recordUsageSafely(options.usageRecorder, options.workspaceUri, record, options.logger);
    },
  });
  const attribution: UsageAttribution = { primary: { kind: 'scene', id: sceneStem } };
  const ctx = await prepareReviseDraftContext(paths, draftUri, sceneStem);
  const session: ReviseSession = { aiService, registry, attribution, ctx };

  let body = ctx.draft.body;
  let revisionCount = 0;
  let blocking = 0;
  let passed = false;
  let lastInstructions: string[] = [];
  let rejection: ReviseDraftWorkflowResult['rejection'];

  while (!isCancelled()) {
    options.onProgress?.(`검사 중 (${revisionCount + 1}/${maxIterations + 1})…`);

    const { continuityIssues, critiqueIssues } = await runReviewChecks(session, body);
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
      ctx.context.characters,
      lastInstructions,
    );
    const applied = await applyRevisionPasses(
      session,
      revisionPasses,
      body,
      isCancelled,
      maxCompressionPercent,
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

  if (revisionCount > 0 && !rejection && !isCancelled()) {
    await writeDraftFile(
      draftUri,
      vscodeFsAdapter,
      createDraft({ sceneStem, format: ctx.draft.format, body }),
    );
  }

  return {
    passed,
    revisionCount,
    remainingBlocking: blocking,
    cancelled: isCancelled(),
    instructions: lastInstructions,
    preservedOriginal: rejection !== undefined,
    rejection,
  };
}

export class ReviseDraftUseCase {
  public constructor(private readonly dependencies: ReviseDraftUseCaseDependencies) {}

  public async execute(request: ReviseDraftRequest): Promise<ReviseDraftWorkflowResult> {
    return await runReviseDraftWorkflow({ ...this.dependencies, ...request });
  }
}
