import {
  isRunBudgetExceeded,
  readWorkspaceRunLock,
  type IFileSystem,
  type ApplyCompletedScenesResult,
  type ApplyStoryProposals,
  type CompletedStoryScene,
  type CompleteStoryScenesProposal,
  type CompleteStoryScenesRequest,
  type CompleteStoryScenesUseCase,
  type GenerateOutlineRequest,
  type GenerateOutlineResult,
  type GenerateOutlineUseCase,
  type INovelRunStateRepository,
  type IOutlineRepository,
  type NovelPipeline,
  type NovelPipelineResult,
  type NovelPipelineRunOptions,
  type SeedScenesRequest,
  type SeedScenesResult,
  type SeedScenesUseCase,
  type UpdateProjectContractRequest,
  type UpdateProjectContractResult,
  type UpdateProjectContractUseCase,
  type StoryFileSnapshot,
  type UsageMeter,
  type UsageMeterSession,
} from '@storyboard/story-engine';
import type { ConfigBridge } from '@storyboard/story-ai';
import {
  isResumable,
  type NovelRunState,
  type StoryboardProject,
  type StoryUri,
  type UsageAmount,
  type UsageCacheAmount,
  type WorkspaceRunLockRecord,
} from '@storyboard/story-model';

export interface NovelManagerDependencies {
  readonly novelPipeline: NovelPipeline;
  readonly generateOutlineUseCase: GenerateOutlineUseCase;
  readonly completeStoryScenesUseCase: CompleteStoryScenesUseCase;
  readonly seedScenesUseCase: SeedScenesUseCase;
  readonly updateProjectContractUseCase: UpdateProjectContractUseCase;
  readonly applyStoryProposals: ApplyStoryProposals;
  readonly novelRunStateRepository: INovelRunStateRepository;
  readonly outlineRepository: IOutlineRepository;
  readonly configBridge: ConfigBridge;
  readonly usageMeter: UsageMeter;
  readonly fileSystem: IFileSystem;
}

export interface NovelRunRequest extends Omit<NovelPipelineRunOptions, 'reviseMaxIterations'> {
  readonly reviseMaxIterations?: number;
  readonly onSpendingChange?: (reading: UsageAmount) => void;
  readonly onBudgetReached?: () => void;
}

export interface NovelRunSpending {
  readonly costUsd: number;
  readonly budgetUsd: number;
  readonly isOverBudget: boolean;
  readonly cache?: UsageCacheAmount;
}

export interface NovelRunResult extends NovelPipelineResult {
  readonly spending: NovelRunSpending;
}

export class NovelManager {
  public readonly runState: INovelRunStateRepository;

  public constructor(private readonly deps: NovelManagerDependencies) {
    this.runState = deps.novelRunStateRepository;
  }

  public async run(request: NovelRunRequest): Promise<NovelRunResult> {
    const { configBridge, usageMeter, novelPipeline } = this.deps;
    const budgetUsd: number = configBridge.getRunBudgetUsd();
    const spending: UsageMeterSession = usageMeter.startSession(request.onSpendingChange);
    const isOverBudget = (): boolean => isRunBudgetExceeded(spending.reading(), budgetUsd);
    let hasReportedBudget: boolean = false;

    try {
      const pipelineRun: NovelPipelineResult = await novelPipeline.run({
        ...request,
        reviseMaxIterations: request.reviseMaxIterations ?? configBridge.getReviseMaxIterations(),
        shouldPause: (): boolean => {
          if (isOverBudget()) {
            if (!hasReportedBudget) {
              hasReportedBudget = true;
              request.onBudgetReached?.();
            }

            return true;
          }

          return request.shouldPause?.() ?? false;
        },
      });

      return {
        ...pipelineRun,
        spending: {
          costUsd: spending.reading().costUsd,
          budgetUsd,
          isOverBudget: isOverBudget(),
          ...(spending.reading().cache === undefined ? {} : { cache: spending.reading().cache }),
        },
      };
    } finally {
      spending.stop();
    }
  }

  public async findResumableRun(
    workspaceRoot: StoryUri,
    options: { readonly holdsRunLock: boolean },
  ): Promise<NovelRunState | undefined> {
    const state: NovelRunState | undefined = await this.runState.readExisting(workspaceRoot);

    if (state?.status !== 'running') {
      return isResumable(state) ? state : undefined;
    }

    if (options.holdsRunLock) {
      return state;
    }

    const holder: WorkspaceRunLockRecord | undefined = await readWorkspaceRunLock({
      fileSystem: this.deps.fileSystem,
      workspaceRoot,
    });

    return holder === undefined ? state : undefined;
  }

  public readProject(workspaceRoot: StoryUri): Promise<StoryboardProject> {
    return this.deps.outlineRepository.loadProject(workspaceRoot);
  }

  public updateContract(
    request: UpdateProjectContractRequest,
  ): Promise<UpdateProjectContractResult> {
    return this.deps.updateProjectContractUseCase.execute(request);
  }

  public generateOutline(request: GenerateOutlineRequest): Promise<GenerateOutlineResult> {
    return this.deps.generateOutlineUseCase.execute(request);
  }

  public seedScenes(request: SeedScenesRequest): Promise<SeedScenesResult> {
    return this.deps.seedScenesUseCase.execute(request);
  }

  public completeScenes(request: CompleteStoryScenesRequest): Promise<CompleteStoryScenesProposal> {
    return this.deps.completeStoryScenesUseCase.execute(request);
  }

  public applyCompletedScenes(
    workspaceRoot: StoryUri,
    scenes: readonly CompletedStoryScene[],
  ): Promise<ApplyCompletedScenesResult> {
    return this.deps.applyStoryProposals.applyCompletedScenes(workspaceRoot, scenes);
  }

  public hasCurrentCompletionSources(snapshots: readonly StoryFileSnapshot[]): Promise<boolean> {
    return this.deps.completeStoryScenesUseCase.hasCurrentSources(snapshots);
  }
}
