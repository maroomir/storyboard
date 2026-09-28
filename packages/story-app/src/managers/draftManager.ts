import type {
  ApplyAugmentedDraftRequest,
  ApplyDraftFormatRequest,
  ApplyDraftFormatResult,
  ApplyDraftFormatUseCase,
  AugmentDraftRequest,
  AugmentDraftResult,
  AugmentDraftUseCase,
  CondenseDraftRequest,
  CondenseDraftResult,
  CondenseDraftUseCase,
  ExpandDraftRequest,
  ExpandDraftResult,
  ExpandDraftUseCase,
  GenerateAllDraftsOptions,
  GenerateAllDraftsResult,
  GenerateAllDraftsUseCase,
  GenerateDraftRequest,
  GenerateDraftResult,
  GenerateDraftUseCase,
  GenerateSceneBeatsRequest,
  GenerateSceneBeatsResult,
  GenerateSceneBeatsUseCase,
  ISceneSidebarRepository,
  ReviseAfterGenerateGate,
  ReviseAfterGenerateHooks,
  ReviseDraftRequest,
  ReviseDraftUseCase,
  ReviseDraftWorkflowResult,
  ReviseGateHooks,
  SaveDraftEditRequest,
  SaveDraftEditResult,
  SaveDraftEditUseCase,
} from '@storyboard/story-engine';
import type { StoryUri } from '@storyboard/story-format';

export interface DraftManagerDependencies {
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly generateAllDraftsUseCase: GenerateAllDraftsUseCase;
  readonly generateSceneBeatsUseCase: GenerateSceneBeatsUseCase;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
  readonly reviseAfterGenerateGate: ReviseAfterGenerateGate;
  readonly applyDraftFormatUseCase: ApplyDraftFormatUseCase;
  readonly augmentDraftUseCase: AugmentDraftUseCase;
  readonly condenseDraftUseCase: CondenseDraftUseCase;
  readonly expandDraftUseCase: ExpandDraftUseCase;
  readonly saveDraftEditUseCase: SaveDraftEditUseCase;
  readonly sceneSidebarRepository: ISceneSidebarRepository;
}

// Everything an app does to one scene's draft: generate it, revise it, reshape it, save an edit.
export class DraftManager {
  public readonly scenes: ISceneSidebarRepository;

  public constructor(private readonly deps: DraftManagerDependencies) {
    this.scenes = deps.sceneSidebarRepository;
  }

  public generate(request: GenerateDraftRequest): Promise<GenerateDraftResult> {
    return this.deps.generateDraftUseCase.execute(request);
  }

  public generateAll(request: GenerateAllDraftsOptions = {}): Promise<GenerateAllDraftsResult> {
    return this.deps.generateAllDraftsUseCase.execute(request);
  }

  public generateBeats(request: GenerateSceneBeatsRequest): Promise<GenerateSceneBeatsResult> {
    return this.deps.generateSceneBeatsUseCase.execute(request);
  }

  public revise(request: ReviseDraftRequest): Promise<ReviseDraftWorkflowResult> {
    return this.deps.reviseDraftUseCase.execute(request);
  }

  // Runs the configured post-generation revision for a scene, or nothing when it is switched off.
  public reviseAfterGenerate(
    sceneUri: StoryUri,
    hooks: ReviseAfterGenerateHooks = {},
  ): Promise<ReviseDraftWorkflowResult | undefined> {
    return this.deps.reviseAfterGenerateGate.maybeRunAfterGenerate(sceneUri, hooks);
  }

  public reviseScene(
    workspaceUri: StoryUri,
    sceneStem: string,
    hooks: ReviseGateHooks = {},
  ): Promise<ReviseDraftWorkflowResult | undefined> {
    return this.deps.reviseAfterGenerateGate.runForScene(workspaceUri, sceneStem, hooks);
  }

  public applyFormat(request: ApplyDraftFormatRequest): Promise<ApplyDraftFormatResult> {
    return this.deps.applyDraftFormatUseCase.execute(request);
  }

  public prepareAugmentation(request: AugmentDraftRequest): Promise<AugmentDraftResult> {
    return this.deps.augmentDraftUseCase.prepareAugmentedDraft(request);
  }

  public applyAugmentation(request: ApplyAugmentedDraftRequest): Promise<void> {
    return this.deps.augmentDraftUseCase.applyAugmentedDraft(request);
  }

  public condense(request: CondenseDraftRequest): Promise<CondenseDraftResult> {
    return this.deps.condenseDraftUseCase.execute(request);
  }

  public expand(request: ExpandDraftRequest): Promise<ExpandDraftResult> {
    return this.deps.expandDraftUseCase.execute(request);
  }

  public saveEdit(request: SaveDraftEditRequest): Promise<SaveDraftEditResult> {
    return this.deps.saveDraftEditUseCase.execute(request);
  }
}
