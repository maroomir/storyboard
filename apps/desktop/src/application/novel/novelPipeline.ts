import {
  getStoryboardProjectPaths,
  type StoryboardProjectPaths,
} from '../../infrastructure/vscode/pathConventions';
import { resolveScenePrefixDigitCount } from '@storyboard/story-format';
import type { NovelRunState, NovelStageName } from '../../domain/files/novelRunState';
import {
  cancel,
  groupChapterStems,
  pauseForApproval,
  runAssembleStage,
  runChapterStages,
  runOutlineStage,
  runReviewStage,
  runSeedsStage,
  runSummariesStage,
} from './novelStages';
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

interface NovelRunContext {
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

  return { paths, state, completed, persist, runStageOnce, newAiService };
}

async function runNovelPipeline(options: NovelPipelineOptions): Promise<NovelPipelineResult> {
  const { paths, state, completed, persist, runStageOnce, newAiService } =
    createNovelRunContext(options);

  try {
    await persist({ status: 'running' });

    const outlineWasCompleted = completed.has('outline');
    await runStageOnce('outline', '아웃라인 생성 중…', () =>
      runOutlineStage(
        options.workspaceUri,
        options.project,
        newAiService(),
        options.deps.outlineRepository,
      ),
    );

    if (!outlineWasCompleted && options.runMode !== 'auto') {
      const paused = await pauseForApproval(options, persist, {
        kind: 'outline',
        info: '아웃라인(synopsis.md, chapters.yaml)을 검토하세요. 계속할까요?',
        pausedMessage: '아웃라인 승인 대기에서 멈췄습니다.',
      });
      if (paused) {
        return paused;
      }
    }
    if (options.shouldCancel()) {
      return await cancel(persist);
    }

    const plan = await options.deps.outlineRepository.loadChapterPlan(options.workspaceUri);
    const digitCount = resolveScenePrefixDigitCount(
      options.project.editor.scenePrefixDigits,
      options.deps.configBridge.inspectScenePrefixDigits(),
    );
    const groups = groupChapterStems(plan, digitCount);

    await runStageOnce('seeds', '씬 시드 생성 중…', () =>
      runSeedsStage(options.workspaceUri, plan, digitCount, options.deps.sceneSeedRepository),
    );
    if (options.shouldCancel()) {
      return await cancel(persist);
    }

    const chapterResult = await runChapterStages({
      options,
      paths,
      groups,
      state,
      completed,
      persist,
    });
    if (chapterResult) {
      return chapterResult;
    }
    if (options.shouldCancel()) {
      return await cancel(persist);
    }

    await runStageOnce('assemble', '원고 조립 중…', () =>
      runAssembleStage(options.workspaceUri, options.deps.assembleManuscriptUseCase),
    );

    await runStageOnce('review', '원고 최종 검사 중…', () =>
      runReviewStage(
        options.workspaceUri,
        options.project,
        plan,
        newAiService(),
        options.deps.aiProviderRegistry,
        options.deps.novelReviewRepository,
      ),
    );

    await runStageOnce('summaries', '장별 요약 중…', () =>
      runSummariesStage(options.workspaceUri, options.deps.summarizeChaptersUseCase),
    );

    await persist({ status: 'done' });
    return { outcome: 'completed', message: '장편 생성을 완료했습니다.' };
  } catch (error) {
    options.deps.logger.error('Novel pipeline failed', error);
    const message = error instanceof Error ? error.message : String(error);
    await persist({ status: 'failed', lastError: message }).catch(() => undefined);
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
