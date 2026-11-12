import type {
  ApplyAugmentedDraftRequest,
  ApplyDraftFormatRequest,
  ApplyDraftFormatResult,
  ApplyDraftFormatUseCase,
  CheckDraftRequest,
  CheckDraftResult,
  CheckDraftUseCase,
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
  GenerateStoryStateRequest,
  GenerateStoryStateResult,
  GenerateStoryStateUseCase,
  IFileSystem,
  ISceneSidebarRepository,
  ReviseAfterGenerateGate,
  DraftHistoryArchiver,
  ReviseDraftRequest,
  ReviseDraftUseCase,
  ReviseDraftWorkflowResult,
  RenameSceneRequest,
  RenameSceneResult,
  RenameSceneUseCase,
  MoveSceneRequest,
  MoveSceneResult,
  MoveSceneUseCase,
  RemoveSceneRequest,
  RemoveSceneResult,
  RemoveSceneUseCase,
  ReviseGateHooks,
  SaveDraftEditRequest,
  SaveDraftEditResult,
  SaveDraftEditUseCase,
  WorkspaceCards,
  WorkspaceScenes,
  SceneRoster,
  ChapterSummaryLedger,
  WorkspaceCaches,
} from '@storyboard/story-engine';
import {
  ProjectRepository,
  SceneContextReader,
  SceneNarrationResolver,
  type ChapterNarrationDefaults,
  type SceneThreadContext,
} from '@storyboard/story-engine';
import {
  draftPath,
  getStoryboardProjectPaths,
  parseDraft,
  type Draft,
  sceneContextPaths,
  type NarrativeContext,
  type NarrationDirective,
  type SceneContext,
  type SceneFile,
  type StoryboardProject,
  type StoryboardProjectPaths,
  type SceneListItem,
  type StoryUri,
} from '@storyboard/story-model';

export interface DraftReading {
  readonly uri: StoryUri;
  readonly draft: Draft;
}

export type ReadyDraft = Extract<GenerateDraftResult, { readonly ok: true }>;

export interface GenerateAndReviseDraftRequest extends GenerateDraftRequest {
  readonly isReviseAllowed: boolean;
  readonly onDraftReady?: (draft: ReadyDraft) => Promise<void> | void;
  readonly onReviseProgress?: (message: string) => void;
}

export interface GenerateAndReviseDraftResult {
  readonly generation: GenerateDraftResult;
  readonly revision: ReviseDraftWorkflowResult | undefined;
}

export interface DraftManagerDependencies {
  readonly generateDraftUseCase: GenerateDraftUseCase;
  readonly generateAllDraftsUseCase: GenerateAllDraftsUseCase;
  readonly generateSceneBeatsUseCase: GenerateSceneBeatsUseCase;
  readonly generateStoryStateUseCase: GenerateStoryStateUseCase;
  readonly reviseDraftUseCase: ReviseDraftUseCase;
  readonly reviseAfterGenerateGate: ReviseAfterGenerateGate;
  readonly draftHistoryArchiver: DraftHistoryArchiver;
  readonly applyDraftFormatUseCase: ApplyDraftFormatUseCase;
  readonly checkDraftUseCase: CheckDraftUseCase;
  readonly augmentDraftUseCase: AugmentDraftUseCase;
  readonly condenseDraftUseCase: CondenseDraftUseCase;
  readonly expandDraftUseCase: ExpandDraftUseCase;
  readonly saveDraftEditUseCase: SaveDraftEditUseCase;
  readonly renameSceneUseCase: RenameSceneUseCase;
  readonly moveSceneUseCase: MoveSceneUseCase;
  readonly removeSceneUseCase: RemoveSceneUseCase;
  readonly sceneSidebarRepository: ISceneSidebarRepository;
  readonly fileSystem: IFileSystem;
  readonly cards: WorkspaceCards;
  readonly scenes: WorkspaceScenes;
  readonly summaries: ChapterSummaryLedger;
  readonly caches: WorkspaceCaches;
}

export class DraftManager {
  public readonly scenes: ISceneSidebarRepository;

  public constructor(private readonly deps: DraftManagerDependencies) {
    this.scenes = deps.sceneSidebarRepository;
  }

  public async listScenes(workspaceRoot: StoryUri): Promise<SceneListItem[]> {
    return await this.scenes.list(workspaceRoot);
  }

  public async loadSceneRoster(workspaceRoot: StoryUri): Promise<SceneRoster> {
    return await this.deps.scenes.loadRoster(workspaceRoot);
  }

  public async readScene(
    workspaceRoot: StoryUri,
    sceneReference: string,
  ): Promise<SceneFile | undefined> {
    return await this.deps.scenes.read(workspaceRoot, sceneReference);
  }

  public async readDraft(
    workspaceRoot: StoryUri,
    sceneStem: string,
  ): Promise<DraftReading | undefined> {
    const uri: StoryUri = draftPath(workspaceRoot, sceneStem);

    if (!(await this.deps.fileSystem.exists(uri))) {
      return undefined;
    }

    const text: string = new TextDecoder().decode(await this.deps.fileSystem.readFile(uri));
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

  public async generateAndRevise(
    request: GenerateAndReviseDraftRequest,
  ): Promise<GenerateAndReviseDraftResult> {
    const { isReviseAllowed, onDraftReady, onReviseProgress, ...generateRequest } = request;
    const generation: GenerateDraftResult = await this.generate(generateRequest);

    if (!generation.ok) {
      return { generation, revision: undefined };
    }

    await onDraftReady?.(generation);

    const isFreshDraft: boolean = generation.kind === 'generated';
    const revision: ReviseDraftWorkflowResult | undefined =
      isFreshDraft && isReviseAllowed
        ? await this.deps.reviseAfterGenerateGate.maybeRunAfterGenerate(request.sceneUri, {
            onProgress: onReviseProgress,
            shouldCancel: request.shouldCancel,
          })
        : undefined;

    return { generation, revision };
  }

  public reviseScene(
    workspaceUri: StoryUri,
    sceneStem: string,
    hooks: ReviseGateHooks = {},
  ): Promise<ReviseDraftWorkflowResult | undefined> {
    return this.deps.reviseAfterGenerateGate.runForScene(workspaceUri, sceneStem, hooks);
  }

  public check(request: CheckDraftRequest): Promise<CheckDraftResult> {
    return this.deps.checkDraftUseCase.execute(request);
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

  public archiveDraft(
    workspaceRoot: StoryUri,
    sceneStem: string,
    draftUri?: StoryUri,
  ): Promise<string | undefined> {
    return this.deps.draftHistoryArchiver.archive(
      workspaceRoot,
      sceneStem,
      draftUri,
    );
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

  public generateStoryState(request: GenerateStoryStateRequest): Promise<GenerateStoryStateResult> {
    return this.deps.generateStoryStateUseCase.execute(request);
  }

  public readSceneContext(workspaceRoot: StoryUri, scene: SceneFile): Promise<SceneContext> {
    return new SceneContextReader(
      this.deps.fileSystem,
      this.deps.cards,
      this.deps.scenes,
      this.deps.summaries,
    ).build(
      sceneContextPaths(getStoryboardProjectPaths(workspaceRoot)),
      scene,
    );
  }

  public readSceneNarrative(
    workspaceRoot: StoryUri,
    context: SceneContext,
  ): Promise<NarrativeContext> {
    return new SceneContextReader(
      this.deps.fileSystem,
      this.deps.cards,
      this.deps.scenes,
      this.deps.summaries,
    ).buildNarrative(
      sceneContextPaths(getStoryboardProjectPaths(workspaceRoot)),
      context,
    );
  }

  public async resolveSceneNarration(
    workspaceRoot: StoryUri,
    scene: SceneFile,
  ): Promise<NarrationDirective | undefined> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const resolver: SceneNarrationResolver = new SceneNarrationResolver(
      this.deps.fileSystem,
      this.deps.cards,
      this.deps.scenes,
      this.deps.caches,
    );
    const chapterDefaults: ChapterNarrationDefaults = await resolver.readChapterDefaults(
      paths,
      scene.order,
    );

    return await resolver.resolveNarration(
      paths,
      scene,
      await this.readProject(paths),
      chapterDefaults,
    );
  }

  public async resolveSceneThread(
    workspaceRoot: StoryUri,
    scene: SceneFile,
  ): Promise<SceneThreadContext> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const resolver: SceneNarrationResolver = new SceneNarrationResolver(
      this.deps.fileSystem,
      this.deps.cards,
      this.deps.scenes,
      this.deps.caches,
    );
    const chapterDefaults: ChapterNarrationDefaults = await resolver.readChapterDefaults(
      paths,
      scene.order,
    );

    return await resolver.resolveThread(
      paths,
      scene,
      await this.readProject(paths),
      chapterDefaults.thread,
    );
  }

  private readProject(paths: StoryboardProjectPaths): Promise<StoryboardProject> {
    return new ProjectRepository(this.deps.fileSystem).read(paths.projectJson);
  }

  public renameScene(request: RenameSceneRequest): Promise<RenameSceneResult> {
    return this.deps.renameSceneUseCase.execute(request);
  }

  public moveScene(request: MoveSceneRequest): Promise<MoveSceneResult> {
    return this.deps.moveSceneUseCase.execute(request);
  }

  public removeScene(request: RemoveSceneRequest): Promise<RemoveSceneResult> {
    return this.deps.removeSceneUseCase.execute(request);
  }
}
