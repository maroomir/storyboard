import { getStoryboardProjectPaths, resolveScenePrefixDigitCount } from '@storyboard/story-model';
import type {
  ChapterPlan,
  NovelRunState,
  NovelStageName,
  StoryboardProjectPaths,
} from '@storyboard/story-model';
import { groupChapterStems, type ChapterGroup } from '#engine/application/novel/chapterGrouping';
import type {
  NovelAiService,
  NovelApprovalKind,
  NovelPipelineResult,
  NovelPipelineRunOptions,
  NovelRunDependencies,
  ReviewStageResult,
} from '#engine/application/novel/novelPipelineContract';

export interface ApprovalRequest {
  readonly kind: NovelApprovalKind;
  readonly info: string;
  readonly pausedMessage: string;
}

const defaultPauseReason: string = '진행 중이던 씬까지 마치고 멈췄습니다.';

function nowIso(): string {
  return new Date().toISOString();
}

function cryptoRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class NovelRun {
  public readonly paths: StoryboardProjectPaths;
  public readonly state: NovelRunState;
  public readonly completed: Set<NovelStageName>;
  public review: ReviewStageResult | undefined = undefined;
  private loadedPlan: Promise<ChapterPlan> | undefined = undefined;
  private loadedGroups: Promise<readonly ChapterGroup[]> | undefined = undefined;

  public constructor(
    public readonly services: NovelRunDependencies,
    public readonly options: NovelPipelineRunOptions,
  ) {
    this.paths = getStoryboardProjectPaths(options.workspaceUri);
    this.completed = new Set<NovelStageName>(options.resumeState?.completedStages ?? []);
    this.state = {
      version: '1.0.0',
      runId: options.resumeState?.runId ?? cryptoRunId(),
      startedAt: options.resumeState?.startedAt ?? nowIso(),
      updatedAt: nowIso(),
      runMode: options.runMode,
      status: 'running',
      completedStages: [...this.completed],
      nextChapterIndex: options.resumeState?.nextChapterIndex ?? 0,
    };
  }

  public async persist(patch: Partial<NovelRunState>): Promise<void> {
    Object.assign(this.state, {
      ...patch,
      updatedAt: nowIso(),
      completedStages: [...this.completed],
    });
    await this.services.repositories.novelRunState.save(this.options.workspaceUri, this.state);
  }

  public async runStageOnce(
    stage: NovelStageName,
    label: string,
    run: () => Promise<void>,
  ): Promise<void> {
    if (this.completed.has(stage)) {
      return;
    }
    this.options.onProgress(stage, label);
    await run();
    this.completed.add(stage);
    await this.persist({});
  }

  public newAiService(): NovelAiService {
    return this.services.ai.gateway.createService(this.options.workspaceUri);
  }

  public chapterPlan(): Promise<ChapterPlan> {
    this.loadedPlan ??= this.services.repositories.novelOutline.loadChapterPlan(
      this.options.workspaceUri,
    );
    return this.loadedPlan;
  }

  public scenePrefixDigitCount(): number {
    return resolveScenePrefixDigitCount(
      this.options.project.editor.scenePrefixDigits,
      this.services.host.configBridge.inspectScenePrefixDigits(),
    );
  }

  public chapterGroups(): Promise<readonly ChapterGroup[]> {
    this.loadedGroups ??= this.chapterPlan().then(async (plan) => {
      const sceneStemsByOrder: ReadonlyMap<number, string> =
        await this.services.repositories.sceneSeeds.listSceneStemsByOrder(
          this.options.workspaceUri,
        );
      return groupChapterStems(plan, this.scenePrefixDigitCount(), sceneStemsByOrder);
    });
    return this.loadedGroups;
  }

  public async cancel(): Promise<NovelPipelineResult> {
    await this.persist({ status: 'paused' });
    return {
      outcome: 'cancelled',
      message: '실행을 취소했습니다. 다시 실행하면 이어서 진행합니다.',
    };
  }

  public async pause(reason: string = defaultPauseReason): Promise<NovelPipelineResult> {
    await this.persist({ status: 'paused' });
    return { outcome: 'paused', message: `${reason} 다시 실행하면 이어서 진행합니다.` };
  }

  public async pauseIfRequested(): Promise<NovelPipelineResult | undefined> {
    return this.options.shouldPause?.() ? await this.pause() : undefined;
  }

  public async pauseForApproval(
    request: ApprovalRequest,
  ): Promise<NovelPipelineResult | undefined> {
    const approved: boolean = await this.options.requestApproval(request.kind, request.info);
    if (approved) {
      return undefined;
    }
    await this.persist({ status: 'paused' });
    return { outcome: 'paused', message: request.pausedMessage };
  }

  public async checkpoint(): Promise<NovelPipelineResult | undefined> {
    if (this.options.shouldCancel()) {
      return await this.cancel();
    }

    return await this.pauseIfRequested();
  }
}
