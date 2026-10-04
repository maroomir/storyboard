import {
  isRunBudgetExceeded,
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
} from '@storyboard/story-engine';
import type { ConfigBridge } from '@storyboard/story-ai';
import type { StoryboardProject, StoryUri, UsageAmount } from '@storyboard/story-model';

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
}

export interface NovelRunRequest extends Omit<NovelPipelineRunOptions, 'reviseMaxIterations'> {
  // Defaults to the configured revise loop limit.
  readonly reviseMaxIterations?: number;
  // What the run has spent so far, after every metered call; a host shows it live.
  readonly onSpendingChange?: (reading: UsageAmount) => void;
  // Fired once, when the run first reaches its budget and starts stopping at the scene boundary.
  readonly onBudgetReached?: () => void;
}

export interface NovelRunSpending {
  readonly costUsd: number;
  readonly budgetUsd: number;
  readonly isOverBudget: boolean;
}

export interface NovelRunResult extends NovelPipelineResult {
  readonly spending: NovelRunSpending;
}

// The book-level verbs: plan the outline, run the whole novel pipeline, complete a story's scenes.
export class NovelManager {
  public readonly runState: INovelRunStateRepository;

  public constructor(private readonly deps: NovelManagerDependencies) {
    this.runState = deps.novelRunStateRepository;
  }

  // Runs the pipeline under the configured per-run budget: the run pauses at the next scene
  // boundary once the budget is reached, and the result says what it spent, so no host meters it.
  public async run(request: NovelRunRequest): Promise<NovelRunResult> {
    const { configBridge, usageMeter, novelPipeline } = this.deps;
    const budgetUsd = configBridge.getRunBudgetUsd();
    const spending = usageMeter.startSession(request.onSpendingChange);
    const isOverBudget = (): boolean => isRunBudgetExceeded(spending.reading(), budgetUsd);
    let hasReportedBudget = false;

    try {
      const result = await novelPipeline.run({
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
        ...result,
        spending: { costUsd: spending.reading().costUsd, budgetUsd, isOverBudget: isOverBudget() },
      };
    } finally {
      spending.stop();
    }
  }

  // The work itself: its name, format and the contract every generation reads.
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

  // Scene cards from the chapter plan `generateOutline` wrote.
  public seedScenes(request: SeedScenesRequest): Promise<SeedScenesResult> {
    return this.deps.seedScenesUseCase.execute(request);
  }

  public completeScenes(request: CompleteStoryScenesRequest): Promise<CompleteStoryScenesProposal> {
    return this.deps.completeStoryScenesUseCase.execute(request);
  }

  // Writes the scenes `completeScenes` proposed, leaving any file that already exists.
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
