import { getStoryboardProjectPaths, type StoryboardProjectPaths } from '#engine/paths/projectPaths';
import { resolveScenePrefixDigitCount } from '@storyboard/story-format';
import type { ChapterPlan } from '@storyboard/story-format';
import type { NovelRunState, NovelStageName } from '#engine/domain/files/novelRunState';
import {
  cancel,
  groupChapterStems,
  pauseForApproval,
  pauseIfRequested,
  runAssembleStage,
  runChapterStages,
  runOutlineStage,
  runReviewStage,
  runReviseFromReviewStage,
  runSeedsStage,
  runSummariesStage,
  type ChapterGroup,
  type ReviewStageResult,
} from './novelStages';
import { resolveNovelPipelinePlan } from './novelStageCatalog';
import type {
  NovelAiService,
  NovelPipelineDependencies,
  NovelPipelineOptions,
  NovelPipelineResult,
  NovelPipelineRunOptions,
} from './novelPipelineTypes';

export type {
  INovelOutlineRepository,
  INovelReviewRepository,
  INovelRunStateRepository,
  ISceneSeedRepository,
  NovelReviewSource,
} from './novelPipelinePorts';
export type {
  NovelApprovalKind,
  NovelPipelineDependencies,
  NovelPipelineOptions,
  NovelPipelineOutcome,
  NovelPipelineResult,
  NovelPipelineRunOptions,
} from './novelPipelineTypes';

// The run state every stage shares: what is persisted, what a stage finished, and the chapter plan
// once the outline exists. A stage returns a result only to stop the run (paused, cancelled).
interface NovelRunContext {
  readonly options: NovelPipelineOptions;
  readonly paths: StoryboardProjectPaths;
  readonly state: NovelRunState;
  readonly completed: Set<NovelStageName>;
  readonly persist: (patch: Partial<NovelRunState>) => Promise<void>;
  readonly runStageOnce: (
    stage: NovelStageName,
    label: string,
    run: () => Promise<void>,
  ) => Promise<void>;
  readonly newAiService: () => NovelAiService;
  readonly chapterPlan: () => Promise<ChapterPlan>;
  readonly chapterGroups: () => Promise<readonly ChapterGroup[]>;
  // What the review stage found on this run, for the rewrite stage that follows it.
  review: ReviewStageResult | undefined;
}

export interface INovelStage {
  readonly id: NovelStageName;
  run(ctx: NovelRunContext): Promise<NovelPipelineResult | undefined>;
}

function createNovelRunContext(options: NovelPipelineOptions): NovelRunContext {
  const paths = getStoryboardProjectPaths(options.workspaceUri);
  const completed = new Set<NovelStageName>(options.resumeState?.completedStages ?? []);
  const now = (): string => new Date().toISOString();

  const state: NovelRunState = {
    version: '1.0.0',
    runId: options.resumeState?.runId ?? cryptoRunId(),
    startedAt: options.resumeState?.startedAt ?? now(),
    updatedAt: now(),
    runMode: options.runMode,
    status: 'running',
    completedStages: [...completed],
    nextChapterIndex: options.resumeState?.nextChapterIndex ?? 0,
  };

  const persist = async (patch: Partial<NovelRunState>): Promise<void> => {
    Object.assign(state, { ...patch, updatedAt: now(), completedStages: [...completed] });
    await options.deps.novelRunStateRepository.save(options.workspaceUri, state);
  };

  const newAiService = (): NovelAiService =>
    options.deps.aiGateway.createService(options.workspaceUri);

  const runStageOnce = async (
    stage: NovelStageName,
    label: string,
    run: () => Promise<void>,
  ): Promise<void> => {
    if (completed.has(stage)) {
      return;
    }
    options.onProgress(stage, label);
    await run();
    completed.add(stage);
    await persist({});
  };

  let loadedPlan: Promise<ChapterPlan> | undefined;
  const chapterPlan = (): Promise<ChapterPlan> => {
    loadedPlan ??= options.deps.outlineRepository.loadChapterPlan(options.workspaceUri);
    return loadedPlan;
  };

  let loadedGroups: Promise<readonly ChapterGroup[]> | undefined;
  const chapterGroups = (): Promise<readonly ChapterGroup[]> => {
    loadedGroups ??= chapterPlan().then((plan) => {
      const digitCount = resolveScenePrefixDigitCount(
        options.project.editor.scenePrefixDigits,
        options.deps.configBridge.inspectScenePrefixDigits(),
      );
      return groupChapterStems(plan, digitCount);
    });
    return loadedGroups;
  };

  return {
    options,
    paths,
    state,
    completed,
    persist,
    runStageOnce,
    newAiService,
    chapterPlan,
    chapterGroups,
    review: undefined,
  };
}

// A stage boundary where a cancel or a pause request takes effect.
async function checkpoint(ctx: NovelRunContext): Promise<NovelPipelineResult | undefined> {
  if (ctx.options.shouldCancel()) {
    return await cancel(ctx.persist);
  }

  return await pauseIfRequested(ctx.options, ctx.persist);
}

const outlineStage: INovelStage = {
  id: 'outline',
  async run(ctx) {
    const { options } = ctx;
    const wasCompleted = ctx.completed.has('outline');

    await ctx.runStageOnce('outline', '아웃라인 생성 중…', () =>
      runOutlineStage(
        options.workspaceUri,
        options.project,
        ctx.newAiService(),
        options.deps.outlineRepository,
      ),
    );

    if (!wasCompleted && options.runMode !== 'auto') {
      const paused = await pauseForApproval(options, ctx.persist, {
        kind: 'outline',
        info: '아웃라인(synopsis.md, chapters.yaml)을 검토하세요. 계속할까요?',
        pausedMessage: '아웃라인 승인 대기에서 멈췄습니다.',
      });
      if (paused) {
        return paused;
      }
    }

    return await checkpoint(ctx);
  },
};

const seedsStage: INovelStage = {
  id: 'seeds',
  async run(ctx) {
    const { options } = ctx;
    const plan = await ctx.chapterPlan();
    const digitCount = resolveScenePrefixDigitCount(
      options.project.editor.scenePrefixDigits,
      options.deps.configBridge.inspectScenePrefixDigits(),
    );

    await ctx.runStageOnce('seeds', '씬 시드 생성 중…', () =>
      runSeedsStage(options.workspaceUri, plan, digitCount, options.deps.sceneSeedRepository),
    );

    return await checkpoint(ctx);
  },
};

const chaptersStage: INovelStage = {
  id: 'chapters',
  async run(ctx) {
    const chapterResult = await runChapterStages({
      options: ctx.options,
      paths: ctx.paths,
      groups: await ctx.chapterGroups(),
      state: ctx.state,
      completed: ctx.completed,
      persist: ctx.persist,
    });
    if (chapterResult) {
      return chapterResult;
    }

    return await checkpoint(ctx);
  },
};

const assembleStage: INovelStage = {
  id: 'assemble',
  async run(ctx) {
    await ctx.runStageOnce('assemble', '원고 조립 중…', () =>
      runAssembleStage(ctx.options.workspaceUri, ctx.options.deps.assembleManuscriptUseCase),
    );
    return undefined;
  },
};

async function reviewVolume(
  ctx: NovelRunContext,
  revisedStems: readonly string[] = [],
): Promise<ReviewStageResult> {
  const { options } = ctx;

  return await runReviewStage(
    options.workspaceUri,
    options.project,
    await ctx.chapterPlan(),
    ctx.newAiService(),
    options.deps.aiProviderRegistry,
    options.deps.novelReviewRepository,
    revisedStems,
  );
}

// The final review reads the whole assembled volume, so it sees contradictions no per-scene check
// can. Its findings feed the rewrite stage; when that stage is already done (a resume after it),
// the review only runs if it never finished itself.
const reviewStage: INovelStage = {
  id: 'review',
  async run(ctx) {
    if (ctx.completed.has('revise-from-review')) {
      await ctx.runStageOnce('review', '원고 최종 검사 중…', async () => {
        await reviewVolume(ctx);
      });
      return undefined;
    }

    ctx.options.onProgress('review', '원고 최종 검사 중…');
    const review = await reviewVolume(ctx);
    ctx.completed.add('review');
    await ctx.persist({});
    ctx.review = review;

    if (review.targets.length === 0) {
      ctx.completed.add('revise-from-review');
      await ctx.persist({});
    }

    return undefined;
  },
};

// The high-severity findings are rewritten once, then the volume is reviewed again so the report
// on disk describes the text that actually shipped.
const reviseFromReviewStage: INovelStage = {
  id: 'revise-from-review',
  async run(ctx) {
    const { options } = ctx;

    if (ctx.completed.has('revise-from-review')) {
      return undefined;
    }

    const review = ctx.review ?? (await reviewVolume(ctx));
    const { targets } = review;

    if (targets.length === 0) {
      ctx.completed.add('revise-from-review');
      await ctx.persist({});
      return undefined;
    }

    if (options.runMode === 'review-approval') {
      const stems = targets.map((target) => target.sceneStem).join(', ');
      const paused = await pauseForApproval(options, ctx.persist, {
        kind: 'review',
        info: `최종 검사에서 high 이슈 ${review.highCount}건을 찾았습니다. 다음 씬을 재작성할까요? ${stems}`,
        pausedMessage: '최종 검사 승인 대기에서 멈췄습니다.',
      });
      if (paused) {
        return paused;
      }
    }

    options.onProgress('revise-from-review', '검수 결과로 재작성 중…');
    const revisedStems = await runReviseFromReviewStage(options, ctx.paths, targets);
    ctx.completed.add('revise-from-review');
    await ctx.persist({});

    if (options.shouldCancel()) {
      return await cancel(ctx.persist);
    }

    options.onProgress('review', '재작성분 재검사 중…');
    await reviewVolume(ctx, revisedStems);

    return undefined;
  },
};

const summariesStage: INovelStage = {
  id: 'summaries',
  async run(ctx) {
    await ctx.runStageOnce('summaries', '장별 요약 중…', () =>
      runSummariesStage(ctx.options.workspaceUri, ctx.options.deps.summarizeChaptersUseCase),
    );
    return undefined;
  },
};

export const novelStages: Readonly<Record<NovelStageName, INovelStage>> = {
  outline: outlineStage,
  seeds: seedsStage,
  chapters: chaptersStage,
  assemble: assembleStage,
  review: reviewStage,
  'revise-from-review': reviseFromReviewStage,
  summaries: summariesStage,
};

// Runs the stages the plan names, in its order, over one run context. The plan is the author's
// `pipelines/novel.yaml` when one is in force, otherwise the bundled order.
async function runNovelPipeline(options: NovelPipelineOptions): Promise<NovelPipelineResult> {
  const ctx = createNovelRunContext(options);

  try {
    await ctx.persist({ status: 'running' });

    for (const id of options.stages ?? resolveNovelPipelinePlan()) {
      const stop = await novelStages[id].run(ctx);
      if (stop) {
        return stop;
      }
    }

    await ctx.persist({ status: 'done' });
    return { outcome: 'completed', message: '장편 생성을 완료했습니다.' };
  } catch (error) {
    options.deps.logger.error('Novel pipeline failed', error);
    const message = error instanceof Error ? error.message : String(error);
    await ctx.persist({ status: 'failed', lastError: message }).catch(() => undefined);
    return { outcome: 'failed', message };
  }
}

export class NovelPipeline {
  public constructor(private readonly dependencies: NovelPipelineDependencies) {}

  public async run(options: NovelPipelineRunOptions): Promise<NovelPipelineResult> {
    return await runNovelPipeline({ ...options, deps: this.dependencies });
  }
}

function cryptoRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
