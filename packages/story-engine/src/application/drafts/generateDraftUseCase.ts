import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type {
  StoryUri,
  BackgroundCard,
  AiProviderId,
  AiTaskName,
  CharacterCard,
  StoryState,
  Draft,
  StyleDirective,
} from '@storyboard/story-model';
import {
  AiProviderError,
  backgroundCardPath,
  characterCardPath,
  draftHistorySceneDirectory,
  joinUri,
  computeDraftBodyHash,
  createDraft,
  joinCardText,
  parseDraft,
  serializeDraft,
  buildStyleDirective,
  archiveExistingDraft,
  readStoryState,
  type SceneCacheRecord,
  extractErrorMessage,
} from '@storyboard/story-model';
import {
  BackgroundFactConflictStore,
  BackgroundMemoryStore,
  PersonaMemoryStore,
  SceneDialogueStore,
} from '#engine/persistence/cardMemoryStores';
import { DraftRepository } from '#engine/persistence/repositories/draftRepository';
import { bibleCandidateFilePath } from '#engine/persistence/bibleCacheWorkspace';
import { cardCandidateFilePath } from '#engine/persistence/cardCacheWorkspace';
import type { StoryboardAiService, TaskAiConfigResolved } from '@storyboard/story-ai';
import { SceneGenerationPipeline } from '#engine/pipeline/scene/sceneGenerationPipeline';
import {
  SceneGenerationPipelineCancelledError,
  type RunSceneGenerationPipelineResult,
  type SceneGenerationPipelineTaskProviders,
} from '#engine/pipeline/sceneGenerationTypes';
import {
  emptyDraftBodyMessage,
  type GenerateDraftRequest,
  type GenerateDraftResult,
  type GenerateDraftWorkflowOptions,
} from './draftGenerationContract';
import {
  loadSceneGenerationInputs,
  reportWorkflowFailure,
  type SceneGenerationInputs,
  type SceneGenerationInputsResult,
} from './sceneGenerationInputs';
import type { IUseCase } from '#engine/application/useCase';
import { updateStoryStateAfterGeneration } from './updateStoryState';
import type { PostGenerationUpdateManager } from '#engine/ai/PostGenerationUpdateManager';

export type { GenerateDraftRequest, GenerateDraftResult } from './draftGenerationContract';

export interface GenerateDraftCollaborators {
  readonly postGenerationUpdates?: PostGenerationUpdateManager;
}

interface PostGenerationUpdateContext {
  readonly updates: PostGenerationUpdateManager;
  readonly inputs: SceneGenerationInputs;
  readonly options: GenerateDraftWorkflowOptions;
  readonly aiService: StoryboardAiService;
  readonly pipelineResult: RunSceneGenerationPipelineResult;
  readonly detectedCharacterCards: CharacterCard[];
}

export class GenerateDraftUseCase implements IUseCase<GenerateDraftRequest, GenerateDraftResult> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
    private readonly collaborators: GenerateDraftCollaborators,
  ) {}

  public async execute(request: GenerateDraftRequest): Promise<GenerateDraftResult> {
    return await this.generateDraftForWorkspaceSceneWorkflow(request.sceneUri, {
      host: this.host,
      ai: this.ai,
      repositories: this.repositories,
      ...this.collaborators,
      ...request,
    });
  }

  private toBackgroundSnapshot(
    background: BackgroundCard | undefined,
  ): SceneCacheRecord['backgroundSnapshot'] {
    if (!background) {
      return undefined;
    }

    return {
      id: background.id,
      name: background.name,
      description: joinCardText(background.description),
    };
  }

  private async isCacheHit(
    inputs: SceneGenerationInputs,
    options: GenerateDraftWorkflowOptions,
  ): Promise<boolean> {
    if (!(await this.host.fileSystem.exists(inputs.draftUri))) {
      return false;
    }

    if (!(await this.host.fileSystem.exists(inputs.cacheUri))) {
      const ledger: StoryState = await readStoryState(
        inputs.threadPaths.storyState,
        this.host.fileSystem,
      );
      return ledger.sceneInputHashes.get(inputs.scene.order) === inputs.inputHash;
    }

    try {
      const record: SceneCacheRecord = await this.repositories.sceneCache.read(inputs.cacheUri);
      return record.inputHash === inputs.inputHash;
    } catch {
      return false;
    }
  }

  private async openCachedDraft(draftUri: StoryUri): Promise<GenerateDraftResult> {
    return { ok: true, kind: 'cache_hit', draftUri };
  }

  private buildSceneCacheRecord(
    inputs: SceneGenerationInputs,
    pipelineResult: Awaited<ReturnType<SceneGenerationPipeline['run']>>,
    providers: SceneCacheRecord['providers'],
    bodyHash: string,
  ): SceneCacheRecord {
    const { scene, context, previousContext, inputHash } = inputs;

    return {
      sceneStem: scene.stem,
      generatedAt: new Date().toISOString(),
      inputHash,
      input: context.scene.body,
      detectedCharacters: pipelineResult.detectedCharacters,
      skeleton: pipelineResult.skeleton,
      ...(pipelineResult.sceneCoordinates.length > 0
        ? { sceneCoordinates: pipelineResult.sceneCoordinates }
        : {}),
      bodyHash,
      personasUsed: Object.fromEntries(pipelineResult.personasUsed),
      backgroundSnapshot: this.toBackgroundSnapshot(context.background),
      previousContext,
      providers,
    };
  }

  private async isDraftOursToOverwrite(
    inputs: SceneGenerationInputs,
    options: GenerateDraftWorkflowOptions,
  ): Promise<boolean> {
    if (!(await this.host.fileSystem.exists(inputs.draftUri))) {
      return true;
    }

    try {
      const record: SceneCacheRecord = await this.repositories.sceneCache.read(inputs.cacheUri);
      if (record.bodyHash === undefined) {
        return false;
      }

      const existing: Draft = parseDraft(
        new TextDecoder().decode(await this.host.fileSystem.readFile(inputs.draftUri)),
      );
      return computeDraftBodyHash(existing.body) === record.bodyHash;
    } catch {
      return false;
    }
  }

  private async maybeArchiveExistingDraft(
    inputs: SceneGenerationInputs,
    options: GenerateDraftWorkflowOptions,
    force: boolean,
  ): Promise<void> {
    if (!force && !this.host.configBridge.isKeepDraftHistoryEnabled()) {
      return;
    }

    const historyDirectory: StoryUri = draftHistorySceneDirectory(
      inputs.workspaceFolder.uri,
      inputs.scene.stem,
    );

    try {
      await archiveExistingDraft({
        draftUri: inputs.draftUri,
        historyDirectory,
        resolveArchiveUri: (fileName) => joinUri(historyDirectory, fileName),
        fileSystem: this.host.fileSystem,
      });
    } catch (error) {
      this.host.logger.warn(`이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(error)}`);
    }
  }

  private async persistGeneratedDraft(
    inputs: SceneGenerationInputs,
    options: GenerateDraftWorkflowOptions,
    aiService: StoryboardAiService,
    pipelineResult: Awaited<ReturnType<SceneGenerationPipeline['run']>>,
    cacheProviders: SceneCacheRecord['providers'],
  ): Promise<GenerateDraftResult> {
    const { paths, threadPaths, scene, draftUri, cacheUri } = inputs;

    if (pipelineResult.draftBody.trim().length === 0) {
      return { ok: false, kind: 'failed', message: emptyDraftBodyMessage(scene.stem) };
    }

    this.logDialoguePolish(scene.stem, pipelineResult);
    const draft: Draft = this.createGeneratedDraft(inputs, pipelineResult);

    await this.repositories.sceneCache.ensureDirectory(paths.sceneCacheDirectory);

    options.onSaving?.();

    const bodyHash: string = computeDraftBodyHash(parseDraft(serializeDraft(draft)).body);
    const cacheRecord: SceneCacheRecord = this.buildSceneCacheRecord(
      inputs,
      pipelineResult,
      cacheProviders,
      bodyHash,
    );

    await this.archiveDraftBeforeOverwrite(inputs, options);

    await this.repositories.drafts.write(draftUri, draft);

    await this.saveDialogueRecord(threadPaths, pipelineResult);

    await this.repositories.sceneCache.write(cacheUri, cacheRecord);

    await updateStoryStateAfterGeneration(inputs, options, aiService, pipelineResult.draftBody);

    if (this.host.configBridge.isUpdateCardsAfterGenerateEnabled()) {
      this.schedulePostGenerationUpdates(inputs, options, aiService, pipelineResult);
    }

    return {
      ok: true,
      kind: 'generated',
      draftUri,
      warnings: [...inputs.warnings, ...pipelineResult.warnings],
    };
  }

  private logDialoguePolish(
    sceneStem: string,
    pipelineResult: RunSceneGenerationPipelineResult,
  ): void {
    if (pipelineResult.dialoguePolish) {
      const { lineCount, polishedCount, contestedCount } = pipelineResult.dialoguePolish;
      this.host.logger.info(
        `${sceneStem}: 대사 다듬기 ${polishedCount}/${lineCount}개 손봄${contestedCount > 0 ? `, ${contestedCount}개는 화자가 겹쳐 뼈대 유지` : ''}`,
      );
    }
  }

  private createGeneratedDraft(
    inputs: SceneGenerationInputs,
    pipelineResult: RunSceneGenerationPipelineResult,
  ): Draft {
    const sceneDraftConfig: TaskAiConfigResolved = this.ai.gateway.getTaskAiConfig('sceneDraft');

    return createDraft({
      sceneStem: inputs.scene.stem,
      format: inputs.project.format,
      body: pipelineResult.draftBody,
      warnings: pipelineResult.warnings,
      generator: this.host.generator,
      providerId: sceneDraftConfig.providerId,
      model: sceneDraftConfig.model,
    });
  }

  private async archiveDraftBeforeOverwrite(
    inputs: SceneGenerationInputs,
    options: GenerateDraftWorkflowOptions,
  ): Promise<void> {
    const isOurs: boolean = await this.isDraftOursToOverwrite(inputs, options);
    if (!isOurs) {
      this.host.logger.warn(
        `이 초안은 마지막 생성 결과와 다릅니다(다른 도구로 생성 또는 직접 수정). 덮어쓰기 전에 .draft 히스토리에 보관합니다: ${inputs.scene.stem}`,
      );
    }
    await this.maybeArchiveExistingDraft(inputs, options, !isOurs);
  }

  private async saveDialogueRecord(
    threadPaths: SceneGenerationInputs['threadPaths'],
    pipelineResult: RunSceneGenerationPipelineResult,
  ): Promise<void> {
    if (pipelineResult.dialogueRecord) {
      await new SceneDialogueStore(this.host.fileSystem, threadPaths).save(
        pipelineResult.dialogueRecord,
      );
    }
  }

  private schedulePostGenerationUpdates(
    inputs: SceneGenerationInputs,
    options: GenerateDraftWorkflowOptions,
    aiService: StoryboardAiService,
    pipelineResult: RunSceneGenerationPipelineResult,
  ): void {
    const updates: PostGenerationUpdateManager | undefined =
      this.collaborators.postGenerationUpdates;

    if (!updates) {
      return;
    }

    const detectedCharacterCards: CharacterCard[] = inputs.context.characters.filter((card) =>
      pipelineResult.detectedCharacters.includes(card.name),
    );
    const updateContext: PostGenerationUpdateContext = {
      updates,
      inputs,
      options,
      aiService,
      pipelineResult,
      detectedCharacterCards,
    };

    this.scheduleCharacterTraits(updateContext);
    this.scheduleBibleCandidates(updateContext);
    this.scheduleCardCandidates(updateContext);
    this.scheduleBackgroundCharacters(updateContext);
  }

  private scheduleCharacterTraits(updateContext: PostGenerationUpdateContext): void {
    const { updates, inputs, options, aiService, pipelineResult, detectedCharacterCards } =
      updateContext;
    const { workspaceFolder, scene } = inputs;

    updates.scheduleCharacterTraits({
      queueKey: workspaceFolder.uri.toString(),
      sceneStem: scene.stem,
      draftBody: pipelineResult.draftBody,
      detectedCharacterCards,
      aiService,
      fileSystem: this.host.fileSystem,
      resolveCharacterCardUri: (card) => characterCardPath(workspaceFolder.uri, card.id),
      logger: this.host.logger,
      onComplete: options.onTraitsUpdateComplete,
    });
  }

  private scheduleBibleCandidates(updateContext: PostGenerationUpdateContext): void {
    const { updates, inputs, aiService, pipelineResult, detectedCharacterCards } = updateContext;
    const { workspaceFolder, paths, scene } = inputs;
    const { fileSystem, logger } = this.host;

    updates.scheduleBibleCandidates({
      queueKey: `${workspaceFolder.uri.toString()}#bible`,
      sceneStem: scene.stem,
      draftBody: pipelineResult.draftBody,
      detectedCharacterCards,
      aiService,
      fileSystem,
      ensureDirectory: () => fileSystem.createDirectory(paths.bibleCacheDirectory),
      resolveCandidateUri: (stem) => bibleCandidateFilePath(paths, stem),
      logger,
    });
  }

  private scheduleCardCandidates(updateContext: PostGenerationUpdateContext): void {
    const { updates, inputs, aiService, pipelineResult, detectedCharacterCards } = updateContext;
    const { workspaceFolder, paths, scene, context } = inputs;
    const { fileSystem, logger } = this.host;

    updates.scheduleCardCandidates({
      queueKey: `${workspaceFolder.uri.toString()}#cards`,
      sceneStem: scene.stem,
      draftBody: pipelineResult.draftBody,
      detectedCharacterCards,
      characterRoster: context.characters.map((card) => ({ id: card.id, name: card.name })),
      aiService,
      verify: this.host.configBridge.isVerifyCardCandidatesEnabled(),
      fileSystem,
      ensureDirectory: () => fileSystem.createDirectory(paths.cardCacheDirectory),
      resolveCandidateUri: (stem) => cardCandidateFilePath(paths, stem),
      logger,
    });
  }

  private scheduleBackgroundCharacters(updateContext: PostGenerationUpdateContext): void {
    const { updates, inputs, detectedCharacterCards } = updateContext;
    const { workspaceFolder, context } = inputs;

    if (context.background) {
      updates.scheduleBackgroundCharacters({
        queueKey: `${workspaceFolder.uri.toString()}#background`,
        backgroundId: context.background.id,
        detectedCharacterCards,
        fileSystem: this.host.fileSystem,
        resolveBackgroundCardUri: (backgroundId) =>
          backgroundCardPath(workspaceFolder.uri, backgroundId),
        logger: this.host.logger,
      });
    }
  }

  private async runAndPersistDraft(
    inputs: SceneGenerationInputs,
    options: GenerateDraftWorkflowOptions,
  ): Promise<GenerateDraftResult> {
    const aiService: StoryboardAiService = this.ai.gateway.createService(
      inputs.workspaceFolder.uri,
    );
    const pipelineProviders: SceneGenerationPipelineTaskProviders = this.resolvePipelineProviders();
    const cacheProviders = {
      ...pipelineProviders,
      traitsExtraction: this.ai.gateway.getTaskProvider('traitsExtraction'),
    } satisfies Partial<Record<AiTaskName, AiProviderId>>;

    const backgroundRecentExcerpt: string | undefined =
      await this.findBackgroundRecentExcerpt(inputs);

    try {
      const pipelineResult: RunSceneGenerationPipelineResult = await this.createScenePipeline(
        inputs,
        options,
        aiService,
        pipelineProviders,
        backgroundRecentExcerpt,
      ).run();

      return await this.persistGeneratedDraft(
        inputs,
        options,
        aiService,
        pipelineResult,
        cacheProviders,
      );
    } catch (error) {
      return this.describeGenerationFailure(error, options);
    }
  }

  private resolvePipelineProviders(): SceneGenerationPipelineTaskProviders {
    return {
      personaGeneration: this.ai.gateway.getTaskProvider('personaGeneration'),
      sceneSkeleton: this.ai.gateway.getTaskProvider('sceneSkeleton'),
      sceneBeatActor: this.ai.gateway.getTaskProvider('sceneBeatActor'),
      sceneBeatArbiter: this.ai.gateway.getTaskProvider('sceneBeatArbiter'),
      sceneBeatJudge: this.ai.gateway.getTaskProvider('sceneBeatJudge'),
      sceneDialoguePolish: this.ai.gateway.getTaskProvider('sceneDialoguePolish'),
      sceneDialogueAttribution: this.ai.gateway.getTaskProvider('sceneDialogueAttribution'),
      sceneSectionExpansion: this.ai.gateway.getTaskProvider('sceneSectionExpansion'),
    };
  }

  private async findBackgroundRecentExcerpt(
    inputs: SceneGenerationInputs,
  ): Promise<string | undefined> {
    const backgroundId: string | undefined = inputs.context.background?.id;

    return backgroundId
      ? await new DraftRepository(this.host.fileSystem).findRecentBackgroundExcerpt(
          inputs.paths,
          inputs.scene.stem,
          backgroundId,
        )
      : undefined;
  }

  private createScenePipeline(
    inputs: SceneGenerationInputs,
    options: GenerateDraftWorkflowOptions,
    aiService: StoryboardAiService,
    providers: SceneGenerationPipelineTaskProviders,
    backgroundRecentExcerpt: string | undefined,
  ): SceneGenerationPipeline {
    const { paths, threadPaths, scene, project, context, previousContext } = inputs;

    return new SceneGenerationPipeline({
      sceneStem: scene.stem,
      context,
      aiService,
      format: project.format,
      styleDirective: this.buildSceneStyleDirective(inputs),
      previousContext,
      canonFactLines: inputs.canonFactLines,
      characterKnowledge: inputs.characterKnowledge,
      characterRelations: inputs.characterRelations,
      providers,
      onProgress: (stage, current, total): void => {
        if (options.shouldCancel?.()) {
          return;
        }

        options.onPipelineProgress?.(stage, current, total);
      },
      shouldCancel: options.shouldCancel,
      useContextCondense: this.host.configBridge.isAiContextCondenseEnabled(),
      sectionOutputLimit: this.host.configBridge.getSectionOutputLimit(),
      tuning: this.host.configBridge.getSceneGenerationTuning(),
      personaStore: new PersonaMemoryStore(this.host.fileSystem, threadPaths, scene.stem),
      backgroundStore: new BackgroundMemoryStore(this.host.fileSystem, threadPaths, scene.stem),
      backgroundFactConflictStore: new BackgroundFactConflictStore(this.host.fileSystem, paths),
      dialogueCorpus: new SceneDialogueStore(this.host.fileSystem, threadPaths),
      backgroundRecentExcerpt,
    });
  }

  private buildSceneStyleDirective(inputs: SceneGenerationInputs): StyleDirective | undefined {
    const { project, scene } = inputs;

    return buildStyleDirective(
      project.setting,
      scene.frontmatter.relationStage,
      scene.frontmatter.targetWordCount,
      scene.body,
      inputs.narration,
    );
  }

  private describeGenerationFailure(
    error: unknown,
    options: GenerateDraftWorkflowOptions,
  ): GenerateDraftResult {
    if (error instanceof SceneGenerationPipelineCancelledError) {
      return { ok: false, kind: 'cancelled' };
    }

    if (error instanceof AiProviderError && error.code === 'usage-limit') {
      return { ok: false, kind: 'failed', reason: 'usage-limit', message: error.message };
    }

    const message: string = extractErrorMessage(error);
    return reportWorkflowFailure(
      options,
      'Draft generation failed',
      error,
      `초안 생성에 실패했습니다: ${message}`,
    );
  }

  private async generateDraftForWorkspaceSceneWorkflow(
    sceneUri: StoryUri,
    options: GenerateDraftWorkflowOptions,
  ): Promise<GenerateDraftResult> {
    const loaded: SceneGenerationInputsResult = await loadSceneGenerationInputs(sceneUri, options);
    if (!loaded.ok) {
      return loaded.result;
    }

    const inputs: SceneGenerationInputs = loaded.inputs;

    if (!options.force && (await this.isCacheHit(inputs, options))) {
      return await this.openCachedDraft(inputs.draftUri);
    }

    return await this.runAndPersistDraft(inputs, options);
  }
}
