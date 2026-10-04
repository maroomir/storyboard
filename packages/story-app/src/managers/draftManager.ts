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
  CreateSceneRequest,
  CreateSceneResult,
  CreateSceneUseCase,
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
  IFileSystem,
  ISceneSidebarRepository,
  ReviseAfterGenerateGate,
  ReviseAfterGenerateHooks,
  ReviseDraftRequest,
  ReviseDraftUseCase,
  ReviseDraftWorkflowResult,
  RenameSceneRequest,
  RenameSceneResult,
  RenameSceneUseCase,
  ReviseGateHooks,
  SaveDraftEditRequest,
  SaveDraftEditResult,
  SaveDraftEditUseCase,
} from '@storyboard/story-engine';
import {
  draftPath,
  getStoryboardProjectPaths,
  parseDraft,
  type Draft,
  type SceneListItem,
  type StoryUri,
} from '@storyboard/story-model';

export interface DraftReading {
  readonly uri: StoryUri;
  readonly draft: Draft;
}

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
  readonly createSceneUseCase: CreateSceneUseCase;
  readonly renameSceneUseCase: RenameSceneUseCase;
  readonly sceneSidebarRepository: ISceneSidebarRepository;
  readonly fileSystem: IFileSystem;
}

// Everything an app does to one scene's draft: generate it, revise it, reshape it, save an edit,
// and rename the scene it belongs to.
export class DraftManager {
  public readonly scenes: ISceneSidebarRepository;

  public constructor(private readonly deps: DraftManagerDependencies) {
    this.scenes = deps.sceneSidebarRepository;
  }

  // The scene cards in number order, each saying whether its draft is missing, current or older
  // than the card. A workspace with no scene directory yet has no scenes.
  public async listScenes(workspaceRoot: StoryUri): Promise<SceneListItem[]> {
    const { sceneDirectory } = getStoryboardProjectPaths(workspaceRoot);

    if (!(await this.deps.fileSystem.exists(sceneDirectory))) {
      return [];
    }

    return await this.scenes.list(workspaceRoot);
  }

  public async readDraft(
    workspaceRoot: StoryUri,
    sceneStem: string,
  ): Promise<DraftReading | undefined> {
    const uri = draftPath(workspaceRoot, sceneStem);

    if (!(await this.deps.fileSystem.exists(uri))) {
      return undefined;
    }

    const text = new TextDecoder().decode(await this.deps.fileSystem.readFile(uri));
    return { uri, draft: parseDraft(text) };
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

  public createScene(request: CreateSceneRequest): Promise<CreateSceneResult> {
    return this.deps.createSceneUseCase.execute(request);
  }

  public renameScene(request: RenameSceneRequest): Promise<RenameSceneResult> {
    return this.deps.renameSceneUseCase.execute(request);
  }
}
