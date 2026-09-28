import type {
  CompleteStoryScenesProposal,
  CompleteStoryScenesRequest,
  CompleteStoryScenesUseCase,
  GenerateOutlineRequest,
  GenerateOutlineResult,
  GenerateOutlineUseCase,
  INovelRunStateRepository,
  NovelPipeline,
  NovelPipelineResult,
  NovelPipelineRunOptions,
  StoryFileSnapshot,
} from '@storyboard/story-engine';

export interface NovelManagerDependencies {
  readonly novelPipeline: NovelPipeline;
  readonly generateOutlineUseCase: GenerateOutlineUseCase;
  readonly completeStoryScenesUseCase: CompleteStoryScenesUseCase;
  readonly novelRunStateRepository: INovelRunStateRepository;
}

// The book-level verbs: plan the outline, run the whole novel pipeline, complete a story's scenes.
export class NovelManager {
  public readonly runState: INovelRunStateRepository;

  public constructor(private readonly deps: NovelManagerDependencies) {
    this.runState = deps.novelRunStateRepository;
  }

  public run(options: NovelPipelineRunOptions): Promise<NovelPipelineResult> {
    return this.deps.novelPipeline.run(options);
  }

  public generateOutline(request: GenerateOutlineRequest): Promise<GenerateOutlineResult> {
    return this.deps.generateOutlineUseCase.execute(request);
  }

  public completeScenes(request: CompleteStoryScenesRequest): Promise<CompleteStoryScenesProposal> {
    return this.deps.completeStoryScenesUseCase.execute(request);
  }

  public hasCurrentCompletionSources(snapshots: readonly StoryFileSnapshot[]): Promise<boolean> {
    return this.deps.completeStoryScenesUseCase.hasCurrentSources(snapshots);
  }
}
