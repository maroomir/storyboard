import { DraftHistoryArchiver } from '#engine/application/drafts/draftHistoryArchiver';
import { ChapterSummaryRefresher } from '#engine/application/manuscript/chapterSummaryRefresher';
import { StoryLedger } from '#engine/persistence/bundles/storyLedger';
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
  StoryState,
  Draft,
  StyleDirective,
} from '@storyboard/story-model';
import {
  AiProviderError,
  computeDraftBodyHash,
  createDraft,
  joinCardText,
  parseDraft,
  serializeDraft,
  buildStyleDirective,
  type SceneCacheRecord,
  extractErrorMessage,
} from '@storyboard/story-model';
import { BackgroundFactConflictStore } from '#engine/persistence/backgroundFactConflictStore';
import {
  BackgroundMemoryStore,
  PersonaMemoryStore,
  SceneDialogueStore,
} from '#engine/persistence/cardMemoryStores';
import { DraftRepository } from '#engine/persistence/repositories/draftRepository';
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
} from '#engine/application/drafts/draftGenerationContract';
import {
  SceneGenerationInputsLoader,
  WorkflowFailureReporter,
  type SceneGenerationInputs,
  type SceneGenerationInputsResult,
} from '#engine/application/drafts/sceneGenerationInputs';
import { sceneCacheDirectoryPath } from '#engine/persistence/sceneCacheWorkspace';
import type { IUseCase } from '#engine/application/useCase';
import { StoryStateRecorder } from '#engine/application/drafts/updateStoryState';

export type { GenerateDraftRequest, GenerateDraftResult } from '#engine/application/drafts/draftGenerationContract';

export class GenerateDraftUseCase implements IUseCase<GenerateDraftRequest, GenerateDraftResult> {
  private readonly inputsLoader: SceneGenerationInputsLoader;
  private readonly storyStateRecorder: StoryStateRecorder;
  private readonly summaryRefresher: ChapterSummaryRefresher;
  private readonly failureReporter: WorkflowFailureReporter;

  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
  ) {
    this.inputsLoader = new SceneGenerationInputsLoader({ host, ai, repositories });
    this.summaryRefresher = new ChapterSummaryRefresher({ host, ai, repositories });
    this.storyStateRecorder = new StoryStateRecorder({ host, ai });
    this.failureReporter = new WorkflowFailureReporter(host.logger);
  }

  public async execute(request: GenerateDraftRequest): Promise<GenerateDraftResult> {
    return await this.generateDraftForWorkspaceSceneWorkflow(request);
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

  private async isCacheHit(inputs: SceneGenerationInputs): Promise<boolean> {
    if (!(await this.host.fileSystem.exists(inputs.draftUri))) {
      return false;
    }

    if (!(await this.host.fileSystem.exists(inputs.cacheUri))) {
      const ledger: StoryState = await new StoryLedger({
        scenes: this.host.scenes,
        cards: this.host.cards,
      }).read(inputs.threadPaths.workspaceRoot, inputs.threadPaths.threadId);
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

  private async isDraftOursToOverwrite(inputs: SceneGenerationInputs): Promise<boolean> {
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

  private async archiveExistingDraft(inputs: SceneGenerationInputs): Promise<void> {
    try {
      await new DraftHistoryArchiver(this.host).archive(
        inputs.workspaceFolder.uri,
        inputs.scene.stem,
        inputs.draftUri,
      );
    } catch (error) {
      this.host.logger.warn(`이전 초안을 판본으로 보관하지 못했습니다: ${String(error)}`);
    }
  }

  private async persistGeneratedDraft(
    inputs: SceneGenerationInputs,
    request: GenerateDraftRequest,
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

    await this.repositories.sceneCache.ensureDirectory(sceneCacheDirectoryPath(paths, scene));

    request.onSaving?.();

    const bodyHash: string = computeDraftBodyHash(parseDraft(serializeDraft(draft)).body);
    const cacheRecord: SceneCacheRecord = this.buildSceneCacheRecord(
      inputs,
      pipelineResult,
      cacheProviders,
      bodyHash,
    );

    await this.archiveDraftBeforeOverwrite(inputs);

    await this.repositories.drafts.write(draftUri, draft);

    await this.saveDialogueRecord(threadPaths, pipelineResult);

    await this.repositories.sceneCache.write(cacheUri, cacheRecord);

    await this.storyStateRecorder.updateAfterGeneration(
      inputs,
      aiService,
      pipelineResult.draftBody,
    );

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

  private async archiveDraftBeforeOverwrite(inputs: SceneGenerationInputs): Promise<void> {
    const isOurs: boolean = await this.isDraftOursToOverwrite(inputs);
    if (!isOurs) {
      this.host.logger.warn(
        `이 초안은 마지막 생성 결과와 다릅니다(다른 도구로 생성 또는 직접 수정). 덮어쓰기 전에 판본으로 보관합니다: ${inputs.scene.stem}`,
      );
    }
    await this.archiveExistingDraft(inputs);
  }

  private async saveDialogueRecord(
    threadPaths: SceneGenerationInputs['threadPaths'],
    pipelineResult: RunSceneGenerationPipelineResult,
  ): Promise<void> {
    if (pipelineResult.dialogueRecord) {
      await new SceneDialogueStore(this.host, threadPaths).save(
        pipelineResult.dialogueRecord,
      );
    }
  }

  private async runAndPersistDraft(
    inputs: SceneGenerationInputs,
    request: GenerateDraftRequest,
  ): Promise<GenerateDraftResult> {
    const aiService: StoryboardAiService = this.ai.gateway.createService(
      inputs.workspaceFolder.uri,
    );
    const pipelineProviders: SceneGenerationPipelineTaskProviders = this.resolvePipelineProviders();
    const cacheProviders: Partial<Record<AiTaskName, AiProviderId>> = pipelineProviders;

    const backgroundRecentExcerpt: string | undefined =
      await this.findBackgroundRecentExcerpt(inputs);

    try {
      const pipelineResult: RunSceneGenerationPipelineResult = await this.createScenePipeline(
        inputs,
        request,
        aiService,
        pipelineProviders,
        backgroundRecentExcerpt,
      ).run();

      return await this.persistGeneratedDraft(
        inputs,
        request,
        aiService,
        pipelineResult,
        cacheProviders,
      );
    } catch (error) {
      return this.describeGenerationFailure(error, request);
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
          inputs.scene,
          (await this.host.scenes.loadRoster(inputs.paths.workspaceRoot)).scenes,
          backgroundId,
        )
      : undefined;
  }

  private createScenePipeline(
    inputs: SceneGenerationInputs,
    request: GenerateDraftRequest,
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
        if (request.shouldCancel?.()) {
          return;
        }

        request.onPipelineProgress?.(stage, current, total);
      },
      shouldCancel: request.shouldCancel,
      useContextCondense: this.host.configBridge.isAiContextCondenseEnabled(),
      sectionOutputLimit: this.host.configBridge.getSectionOutputLimit(),
      tuning: this.host.configBridge.getSceneGenerationTuning(),
      personaStore: new PersonaMemoryStore(this.host, threadPaths, scene.stem),
      backgroundStore: new BackgroundMemoryStore(this.host, threadPaths, scene.stem),
      backgroundFactConflictStore: new BackgroundFactConflictStore(
        this.host.caches,
        paths.workspaceRoot,
      ),
      dialogueCorpus: new SceneDialogueStore(this.host, threadPaths),
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
    request: GenerateDraftRequest,
  ): GenerateDraftResult {
    if (error instanceof SceneGenerationPipelineCancelledError) {
      return { ok: false, kind: 'cancelled' };
    }

    if (error instanceof AiProviderError && error.code === 'usage-limit') {
      return { ok: false, kind: 'failed', reason: 'usage-limit', message: error.message };
    }

    const message: string = extractErrorMessage(error);
    return this.failureReporter.report(
      request,
      'Draft generation failed',
      error,
      `초안 생성에 실패했습니다: ${message}`,
    );
  }

  private async generateDraftForWorkspaceSceneWorkflow(
    request: GenerateDraftRequest,
  ): Promise<GenerateDraftResult> {
    const loaded: SceneGenerationInputsResult = await this.inputsLoader.load(
      request.sceneUri,
      request,
    );
    if (!loaded.ok) {
      return loaded.result;
    }

    const inputs: SceneGenerationInputs = loaded.inputs;

    if (!request.force && (await this.isCacheHit(inputs))) {
      return await this.openCachedDraft(inputs.draftUri);
    }

    const refreshed: SceneGenerationInputsResult = await this.refreshChapterSummaries(
      inputs,
      request,
    );
    return refreshed.ok ? await this.runAndPersistDraft(refreshed.inputs, request) : refreshed.result;
  }

  private async refreshChapterSummaries(
    inputs: SceneGenerationInputs,
    request: GenerateDraftRequest,
  ): Promise<SceneGenerationInputsResult> {
    const summarizedCount: number = await this.summaryRefresher.refreshBefore(
      inputs.paths.workspaceRoot,
      inputs.scene.order,
    );

    return summarizedCount === 0
      ? { ok: true, inputs }
      : await this.inputsLoader.load(request.sceneUri, request);
  }
}
