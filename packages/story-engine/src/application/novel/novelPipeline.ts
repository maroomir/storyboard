import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import {
  getStoryboardProjectPaths,
  type StoryboardProjectPaths,
  resolveScenePrefixDigitCount,
  extractErrorMessage,
} from '@storyboard/story-model';
import type { ChapterPlan, NovelRunState, NovelStageName } from '@storyboard/story-model';
import {
  cancel,
  groupChapterStems,
  pauseForApproval,
  pauseIfRequested,
  runAssembleStage,
  runChapterStages,
  runCharactersStage,
  runOutlineStage,
  runReviewStage,
  runReviseFromReviewStage,
  runSeedsStage,
  runSummariesStage,
  type ChapterGroup,
  type CharactersStageReport,
  type ReviewStageResult,
} from './novelStages';
import { resolveNovelPipelinePlan } from './novelStageCatalog';
import type {
  NovelAiService,
  NovelPipelineCollaborators,
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
  NovelPipelineOptions,
  NovelPipelineOutcome,
  NovelPipelineResult,
  NovelPipelineRunOptions,
} from './novelPipelineTypes';

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
  review: ReviewStageResult | undefined;
}

export interface INovelStage {
  readonly id: NovelStageName;
  run(runContext: NovelRunContext): Promise<NovelPipelineResult | undefined>;
}

function createNovelRunContext(options: NovelPipelineOptions): NovelRunContext {
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(options.workspaceUri);
  const completed: Set<NovelStageName> = new Set<NovelStageName>(
    options.resumeState?.completedStages ?? [],
  );
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
    await options.deps.repositories.novelRunState.save(options.workspaceUri, state);
  };

  const newAiService = (): NovelAiService =>
    options.deps.ai.gateway.createService(options.workspaceUri);

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
    loadedPlan ??= options.deps.repositories.novelOutline.loadChapterPlan(options.workspaceUri);
    return loadedPlan;
  };

  let loadedGroups: Promise<readonly ChapterGroup[]> | undefined;
  const chapterGroups = (): Promise<readonly ChapterGroup[]> => {
    loadedGroups ??= chapterPlan().then(async (plan) => {
      const digitCount: number = resolveScenePrefixDigitCount(
        options.project.editor.scenePrefixDigits,
        options.deps.host.configBridge.inspectScenePrefixDigits(),
      );
      const sceneStemsByOrder: ReadonlyMap<number, string> =
        await options.deps.repositories.sceneSeeds.listSceneStemsByOrder(options.workspaceUri);
      return groupChapterStems(plan, digitCount, sceneStemsByOrder);
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

async function checkpoint(runContext: NovelRunContext): Promise<NovelPipelineResult | undefined> {
  if (runContext.options.shouldCancel()) {
    return await cancel(runContext.persist);
  }

  return await pauseIfRequested(runContext.options, runContext.persist);
}

const outlineStage: INovelStage = {
  id: 'outline',
  async run(runContext) {
    const { options } = runContext;
    const wasCompleted: boolean = runContext.completed.has('outline');

    await runContext.runStageOnce('outline', '아웃라인 생성 중…', () =>
      runOutlineStage(
        options.workspaceUri,
        options.project,
        runContext.newAiService(),
        options.deps.repositories.novelOutline,
      ),
    );

    if (!wasCompleted && options.runMode !== 'auto') {
      const paused: NovelPipelineResult | undefined = await pauseForApproval(
        options,
        runContext.persist,
        {
          kind: 'outline',
          info: '아웃라인(synopsis.md, chapters.yaml)을 검토하세요. 계속할까요?',
          pausedMessage: '아웃라인 승인 대기에서 멈췄습니다.',
        },
      );
      if (paused) {
        return paused;
      }
    }

    return await checkpoint(runContext);
  },
};

const charactersStage: INovelStage = {
  id: 'characters',
  async run(runContext) {
    const { options } = runContext;
    const plan: ChapterPlan = await runContext.chapterPlan();

    await runContext.runStageOnce('characters', '인물 카드 확인 중…', async () => {
      const report: CharactersStageReport = await runCharactersStage(
        options.workspaceUri,
        options.project,
        plan,
        runContext.newAiService(),
        options.deps.repositories.novelOutline,
        options.deps.repositories.cardWriter,
      );

      if (report.writtenCount > 0) {
        options.onProgress('characters', `인물 카드 ${report.writtenCount}장을 만들었습니다.`);
      }
      if (report.missingIds.length > 0) {
        options.onProgress(
          'characters',
          `모델이 카드를 돌려주지 않은 인물이 있습니다: ${report.missingIds.join(', ')}. 카드를 직접 만들어 주세요.`,
        );
      }
      if (report.unusableIds.length > 0) {
        options.onProgress(
          'characters',
          `카드 이름이 될 수 없는 인물 id 라 카드를 만들지 않았습니다: ${report.unusableIds.join(', ')}. outline/chapters.yaml 의 id 를 영소문자로 고쳐 주세요.`,
        );
      }
    });

    return await checkpoint(runContext);
  },
};

const seedsStage: INovelStage = {
  id: 'seeds',
  async run(runContext) {
    const { options } = runContext;
    const plan: ChapterPlan = await runContext.chapterPlan();
    const digitCount: number = resolveScenePrefixDigitCount(
      options.project.editor.scenePrefixDigits,
      options.deps.host.configBridge.inspectScenePrefixDigits(),
    );

    await runContext.runStageOnce('seeds', '씬 시드 생성 중…', () =>
      runSeedsStage(options.workspaceUri, plan, digitCount, options.deps.repositories.sceneSeeds),
    );

    return await checkpoint(runContext);
  },
};

const chaptersStage: INovelStage = {
  id: 'chapters',
  async run(runContext) {
    const chapterResult: NovelPipelineResult | undefined = await runChapterStages({
      options: runContext.options,
      paths: runContext.paths,
      groups: await runContext.chapterGroups(),
      state: runContext.state,
      completed: runContext.completed,
      persist: runContext.persist,
    });
    if (chapterResult) {
      return chapterResult;
    }

    return await checkpoint(runContext);
  },
};

const assembleStage: INovelStage = {
  id: 'assemble',
  async run(runContext) {
    await runContext.runStageOnce('assemble', '원고 조립 중…', () =>
      runAssembleStage(
        runContext.options.workspaceUri,
        runContext.options.deps.collaborators.assembleManuscriptUseCase,
      ),
    );
    return undefined;
  },
};

async function reviewVolume(
  runContext: NovelRunContext,
  revisedStems: readonly string[] = [],
): Promise<ReviewStageResult> {
  const { options } = runContext;

  return await runReviewStage(
    options.workspaceUri,
    options.project,
    await runContext.chapterPlan(),
    runContext.newAiService(),
    options.deps.ai.providerRegistry,
    options.deps.repositories.novelReviews,
    revisedStems,
  );
}

const reviewStage: INovelStage = {
  id: 'review',
  async run(runContext) {
    if (runContext.completed.has('revise-from-review')) {
      await runContext.runStageOnce('review', '원고 최종 검사 중…', async () => {
        await reviewVolume(runContext);
      });
      return undefined;
    }

    runContext.options.onProgress('review', '원고 최종 검사 중…');
    const review: ReviewStageResult = await reviewVolume(runContext);
    runContext.completed.add('review');
    await runContext.persist({});
    runContext.review = review;

    if (review.targets.length === 0) {
      runContext.completed.add('revise-from-review');
      await runContext.persist({});
    }

    return undefined;
  },
};

const reviseFromReviewStage: INovelStage = {
  id: 'revise-from-review',
  async run(runContext) {
    const { options } = runContext;

    if (runContext.completed.has('revise-from-review')) {
      return undefined;
    }

    const review: ReviewStageResult = runContext.review ?? (await reviewVolume(runContext));
    const { targets } = review;

    if (targets.length === 0) {
      runContext.completed.add('revise-from-review');
      await runContext.persist({});
      return undefined;
    }

    if (options.runMode === 'review-approval') {
      const stems: string = targets.map((target) => target.sceneStem).join(', ');
      const paused: NovelPipelineResult | undefined = await pauseForApproval(
        options,
        runContext.persist,
        {
          kind: 'review',
          info: `최종 검사에서 high 이슈 ${review.highCount}건을 찾았습니다. 다음 씬을 재작성할까요? ${stems}`,
          pausedMessage: '최종 검사 승인 대기에서 멈췄습니다.',
        },
      );
      if (paused) {
        return paused;
      }
    }

    options.onProgress('revise-from-review', '검수 결과로 재작성 중…');
    const revisedStems: string[] = await runReviseFromReviewStage(
      options,
      runContext.paths,
      targets,
    );
    runContext.completed.add('revise-from-review');
    await runContext.persist({});

    if (options.shouldCancel()) {
      return await cancel(runContext.persist);
    }

    options.onProgress('review', '재작성분 재검사 중…');
    await reviewVolume(runContext, revisedStems);

    return undefined;
  },
};

const summariesStage: INovelStage = {
  id: 'summaries',
  async run(runContext) {
    await runContext.runStageOnce('summaries', '장별 요약 중…', () =>
      runSummariesStage(
        runContext.options.workspaceUri,
        runContext.options.deps.collaborators.summarizeChaptersUseCase,
      ),
    );
    return undefined;
  },
};

export const novelStages: Readonly<Record<NovelStageName, INovelStage>> = {
  outline: outlineStage,
  characters: charactersStage,
  seeds: seedsStage,
  chapters: chaptersStage,
  assemble: assembleStage,
  review: reviewStage,
  'revise-from-review': reviseFromReviewStage,
  summaries: summariesStage,
};

async function runNovelPipeline(options: NovelPipelineOptions): Promise<NovelPipelineResult> {
  const runContext: NovelRunContext = createNovelRunContext(options);

  try {
    await runContext.persist({ status: 'running' });

    for (const id of options.stages ?? resolveNovelPipelinePlan()) {
      const stop: NovelPipelineResult | undefined = await novelStages[id].run(runContext);
      if (stop) {
        return stop;
      }
    }

    await runContext.persist({ status: 'done' });
    return { outcome: 'completed', message: '장편 생성을 완료했습니다.' };
  } catch (error) {
    options.deps.host.logger.error('Novel pipeline failed', error);
    const message: string = extractErrorMessage(error);
    await runContext.persist({ status: 'failed', lastError: message }).catch(() => undefined);
    return { outcome: 'failed', message };
  }
}

export class NovelPipeline {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
    private readonly collaborators: NovelPipelineCollaborators,
  ) {}

  public async run(options: NovelPipelineRunOptions): Promise<NovelPipelineResult> {
    return await runNovelPipeline({
      ...options,
      deps: {
        host: this.host,
        ai: this.ai,
        repositories: this.repositories,
        collaborators: this.collaborators,
      },
    });
  }
}

function cryptoRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
