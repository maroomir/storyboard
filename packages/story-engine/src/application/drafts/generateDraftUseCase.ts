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
} from '@storyboard/story-model';
import {
  AiProviderError,
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
  createBackgroundFactConflictStore,
  createBackgroundMemoryStore,
  createPersonaMemoryStore,
  createSceneDialogueStore,
} from '#engine/persistence/cardMemoryWorkspace';
import { findRecentBackgroundExcerpt } from '#engine/persistence/backgroundExcerpt';
import type { StoryboardAiService, TaskAiConfigResolved } from '@storyboard/story-ai';
import { SceneGenerationPipeline } from '#engine/pipeline/sceneGenerationPipeline';
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
} from './generateDraftTypes';
import {
  loadSceneGenerationInputs,
  reportWorkflowFailure,
  type SceneGenerationInputs,
  type SceneGenerationInputsResult,
} from './sceneGenerationInputs';
import type { IUseCase } from '#engine/application/useCase';
import { schedulePostGenerationUpdates } from './postGenerationScheduling';
import { updateStoryStateAfterGeneration } from './updateStoryState';
import type { PostGenerationUpdateManager } from '#engine/ai/PostGenerationUpdateManager';

export type { GenerateDraftRequest, GenerateDraftResult } from './generateDraftTypes';

function toBackgroundSnapshot(
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

async function isCacheHit(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
): Promise<boolean> {
  if (!(await options.host.fileSystem.exists(inputs.draftUri))) {
    return false;
  }

  if (!(await options.host.fileSystem.exists(inputs.cacheUri))) {
    const ledger: StoryState = await readStoryState(
      inputs.threadPaths.storyState,
      options.host.fileSystem,
    );
    return ledger.sceneInputHashes.get(inputs.scene.order) === inputs.inputHash;
  }

  try {
    const record: SceneCacheRecord = await options.repositories.sceneCache.read(inputs.cacheUri);
    return record.inputHash === inputs.inputHash;
  } catch {
    return false;
  }
}

async function openCachedDraft(draftUri: StoryUri): Promise<GenerateDraftResult> {
  return { ok: true, kind: 'cache_hit', draftUri };
}

function buildSceneCacheRecord(
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
    backgroundSnapshot: toBackgroundSnapshot(context.background),
    previousContext,
    providers,
  };
}

async function isDraftOursToOverwrite(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
): Promise<boolean> {
  if (!(await options.host.fileSystem.exists(inputs.draftUri))) {
    return true;
  }

  try {
    const record: SceneCacheRecord = await options.repositories.sceneCache.read(inputs.cacheUri);
    if (record.bodyHash === undefined) {
      return false;
    }

    const existing: Draft = parseDraft(
      new TextDecoder().decode(await options.host.fileSystem.readFile(inputs.draftUri)),
    );
    return computeDraftBodyHash(existing.body) === record.bodyHash;
  } catch {
    return false;
  }
}

async function maybeArchiveExistingDraft(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  force: boolean,
): Promise<void> {
  if (!force && !options.host.configBridge.isKeepDraftHistoryEnabled()) {
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
      fileSystem: options.host.fileSystem,
    });
  } catch (error) {
    options.host.logger.warn(`이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(error)}`);
  }
}

async function persistGeneratedDraft(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  aiService: StoryboardAiService,
  pipelineResult: Awaited<ReturnType<SceneGenerationPipeline['run']>>,
  cacheProviders: SceneCacheRecord['providers'],
): Promise<GenerateDraftResult> {
  const { paths, threadPaths, scene, project, draftUri, cacheUri } = inputs;

  if (pipelineResult.draftBody.trim().length === 0) {
    return { ok: false, kind: 'failed', message: emptyDraftBodyMessage(scene.stem) };
  }

  if (pipelineResult.dialoguePolish) {
    const { lineCount, polishedCount, contestedCount } = pipelineResult.dialoguePolish;
    options.host.logger.info(
      `${scene.stem}: 대사 다듬기 ${polishedCount}/${lineCount}개 손봄${contestedCount > 0 ? `, ${contestedCount}개는 화자가 겹쳐 뼈대 유지` : ''}`,
    );
  }

  const sceneDraftConfig: TaskAiConfigResolved = options.ai.gateway.getTaskAiConfig('sceneDraft');
  const draft: Draft = createDraft({
    sceneStem: scene.stem,
    format: project.format,
    body: pipelineResult.draftBody,
    warnings: pipelineResult.warnings,
    generator: options.host.generator,
    providerId: sceneDraftConfig.providerId,
    model: sceneDraftConfig.model,
  });

  await options.repositories.sceneCache.ensureDirectory(paths.sceneCacheDirectory);

  options.onSaving?.();

  const bodyHash: string = computeDraftBodyHash(parseDraft(serializeDraft(draft)).body);
  const cacheRecord: SceneCacheRecord = buildSceneCacheRecord(
    inputs,
    pipelineResult,
    cacheProviders,
    bodyHash,
  );

  const isOurs: boolean = await isDraftOursToOverwrite(inputs, options);
  if (!isOurs) {
    options.host.logger.warn(
      `이 초안은 마지막 생성 결과와 다릅니다(다른 도구로 생성 또는 직접 수정). 덮어쓰기 전에 .draft 히스토리에 보관합니다: ${scene.stem}`,
    );
  }
  await maybeArchiveExistingDraft(inputs, options, !isOurs);

  await options.repositories.drafts.write(draftUri, draft);

  if (pipelineResult.dialogueRecord) {
    await createSceneDialogueStore(options.host.fileSystem, threadPaths).save(
      pipelineResult.dialogueRecord,
    );
  }

  await options.repositories.sceneCache.write(cacheUri, cacheRecord);

  await updateStoryStateAfterGeneration(inputs, options, aiService, pipelineResult.draftBody);

  if (options.host.configBridge.isUpdateCardsAfterGenerateEnabled()) {
    schedulePostGenerationUpdates(inputs, options, aiService, pipelineResult);
  }

  return {
    ok: true,
    kind: 'generated',
    draftUri,
    warnings: [...inputs.warnings, ...pipelineResult.warnings],
  };
}

async function runAndPersistDraft(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
): Promise<GenerateDraftResult> {
  const { workspaceFolder, paths, threadPaths, scene, project, context, previousContext } = inputs;

  const aiService: StoryboardAiService = options.ai.gateway.createService(workspaceFolder.uri);
  const pipelineProviders: SceneGenerationPipelineTaskProviders = {
    personaGeneration: options.ai.gateway.getTaskProvider('personaGeneration'),
    sceneSkeleton: options.ai.gateway.getTaskProvider('sceneSkeleton'),
    sceneBeatActor: options.ai.gateway.getTaskProvider('sceneBeatActor'),
    sceneBeatArbiter: options.ai.gateway.getTaskProvider('sceneBeatArbiter'),
    sceneBeatJudge: options.ai.gateway.getTaskProvider('sceneBeatJudge'),
    sceneDialoguePolish: options.ai.gateway.getTaskProvider('sceneDialoguePolish'),
    sceneDialogueAttribution: options.ai.gateway.getTaskProvider('sceneDialogueAttribution'),
    sceneSectionExpansion: options.ai.gateway.getTaskProvider('sceneSectionExpansion'),
  };
  const cacheProviders = {
    ...pipelineProviders,
    traitsExtraction: options.ai.gateway.getTaskProvider('traitsExtraction'),
  } satisfies Partial<Record<AiTaskName, AiProviderId>>;

  const backgroundId: string | undefined = context.background?.id;
  const backgroundRecentExcerpt: string | undefined = backgroundId
    ? await findRecentBackgroundExcerpt(options.host.fileSystem, paths, scene.stem, backgroundId)
    : undefined;

  try {
    const pipelineResult: RunSceneGenerationPipelineResult = await new SceneGenerationPipeline({
      sceneStem: scene.stem,
      context,
      aiService,
      format: project.format,
      styleDirective: buildStyleDirective(
        project.setting,
        scene.frontmatter.relationStage,
        scene.frontmatter.targetWordCount,
        scene.body,
        inputs.narration,
      ),
      previousContext,
      canonFactLines: inputs.canonFactLines,
      characterKnowledge: inputs.characterKnowledge,
      characterRelations: inputs.characterRelations,
      providers: pipelineProviders,
      onProgress: (stage, current, total): void => {
        if (options.shouldCancel?.()) {
          return;
        }

        options.onPipelineProgress?.(stage, current, total);
      },
      shouldCancel: options.shouldCancel,
      useContextCondense: options.host.configBridge.isAiContextCondenseEnabled(),
      sectionOutputLimit: options.host.configBridge.getSectionOutputLimit(),
      tuning: options.host.configBridge.getSceneGenerationTuning(),
      personaStore: createPersonaMemoryStore(options.host.fileSystem, threadPaths, scene.stem),
      backgroundStore: createBackgroundMemoryStore(
        options.host.fileSystem,
        threadPaths,
        scene.stem,
      ),
      backgroundFactConflictStore: createBackgroundFactConflictStore(
        options.host.fileSystem,
        paths,
      ),
      dialogueCorpus: createSceneDialogueStore(options.host.fileSystem, threadPaths),
      backgroundRecentExcerpt,
    }).run();

    return await persistGeneratedDraft(inputs, options, aiService, pipelineResult, cacheProviders);
  } catch (error) {
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
}

async function generateDraftForWorkspaceSceneWorkflow(
  sceneUri: StoryUri,
  options: GenerateDraftWorkflowOptions,
): Promise<GenerateDraftResult> {
  const loaded: SceneGenerationInputsResult = await loadSceneGenerationInputs(sceneUri, options);
  if (!loaded.ok) {
    return loaded.result;
  }

  const inputs: SceneGenerationInputs = loaded.inputs;

  if (!options.force && (await isCacheHit(inputs, options))) {
    return await openCachedDraft(inputs.draftUri);
  }

  return await runAndPersistDraft(inputs, options);
}

export interface GenerateDraftCollaborators {
  readonly postGenerationUpdates?: PostGenerationUpdateManager;
}

export class GenerateDraftUseCase implements IUseCase<GenerateDraftRequest, GenerateDraftResult> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
    private readonly collaborators: GenerateDraftCollaborators,
  ) {}

  public async execute(request: GenerateDraftRequest): Promise<GenerateDraftResult> {
    return await generateDraftForWorkspaceSceneWorkflow(request.sceneUri, {
      host: this.host,
      ai: this.ai,
      repositories: this.repositories,
      ...this.collaborators,
      ...request,
    });
  }
}
