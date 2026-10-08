import type { StoryUri, BackgroundCard, AiProviderId, AiTaskName } from '@storyboard/story-model';
import {
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
} from '@storyboard/story-model';
import {
  createBackgroundMemoryStore,
  createPersonaMemoryStore,
  createSceneDialogueStore,
} from '#engine/persistence/cardMemoryWorkspace';
import { findRecentBackgroundExcerpt } from '#engine/persistence/backgroundExcerpt';
import type { StoryboardAiService } from '@storyboard/story-ai';
import { SceneGenerationPipeline } from '#engine/pipeline/sceneGenerationPipeline';
import { SceneGenerationPipelineCancelledError } from '#engine/pipeline/sceneGenerationTypes';
import {
  emptyDraftBodyMessage,
  type GenerateDraftRequest,
  type GenerateDraftResult,
  type GenerateDraftUseCaseDependencies,
  type GenerateDraftWorkflowOptions,
} from './generateDraftTypes';
import {
  loadSceneGenerationInputs,
  reportWorkflowFailure,
  type SceneGenerationInputs,
} from './sceneGenerationInputs';
import type { IUseCase } from '#engine/application/useCase';
import { schedulePostGenerationUpdates } from './postGenerationScheduling';
import { updateStoryStateAfterGeneration } from './updateStoryState';

export type {
  GenerateDraftRequest,
  GenerateDraftResult,
  GenerateDraftUseCaseDependencies,
} from './generateDraftTypes';

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

// NOTE: 씬 캐시는 작품의 .gitignore가 무시하므로 git으로 받은 작품에는 없다. 그때는 커밋되는 이야기
// 상태 원장이 그 씬을 마지막으로 생성한 입력 해시를 대신 근거로 삼는다. 캐시가 있으면 캐시가 우선이다.
async function isCacheHit(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
): Promise<boolean> {
  if (!(await options.fileSystem.exists(inputs.draftUri))) {
    return false;
  }

  if (!(await options.fileSystem.exists(inputs.cacheUri))) {
    const ledger = await readStoryState(inputs.threadPaths.storyState, options.fileSystem);
    return ledger.sceneInputHashes.get(inputs.scene.order) === inputs.inputHash;
  }

  try {
    const record = await options.sceneCacheRepository.read(inputs.cacheUri);
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
  result: Awaited<ReturnType<SceneGenerationPipeline['run']>>,
  providers: SceneCacheRecord['providers'],
  bodyHash: string,
): SceneCacheRecord {
  const { scene, context, previousContext, inputHash } = inputs;

  return {
    sceneStem: scene.stem,
    generatedAt: new Date().toISOString(),
    inputHash,
    input: context.scene.body,
    detectedCharacters: result.detectedCharacters,
    skeleton: result.skeleton,
    bodyHash,
    personasUsed: Object.fromEntries(result.personasUsed),
    backgroundSnapshot: toBackgroundSnapshot(context.background),
    previousContext,
    providers,
  };
}

// NOTE: 디스크의 초안이 우리가 마지막으로 쓴 그것인지 판정한다. 사람이 고친 초안이나 캐시 기록
// 없이 만들어진 초안은 여기서 거짓이 되고, 그런 초안은 히스토리 설정과 무관하게 보관한 뒤에만
// 덮어쓴다. 기록 자체가 없거나 구버전 기록에 bodyHash가 없으면 판정 불가이므로 보수적으로
// 보관한다.
async function isDraftOursToOverwrite(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
): Promise<boolean> {
  if (!(await options.fileSystem.exists(inputs.draftUri))) {
    return true;
  }

  try {
    const record = await options.sceneCacheRepository.read(inputs.cacheUri);
    if (record.bodyHash === undefined) {
      return false;
    }

    const existing = parseDraft(
      new TextDecoder().decode(await options.fileSystem.readFile(inputs.draftUri)),
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
  if (!force && !options.configBridge.isKeepDraftHistoryEnabled()) {
    return;
  }

  const historyDirectory = draftHistorySceneDirectory(
    inputs.workspaceFolder.uri,
    inputs.scene.stem,
  );

  try {
    await archiveExistingDraft({
      draftUri: inputs.draftUri,
      historyDirectory,
      resolveArchiveUri: (fileName) => joinUri(historyDirectory, fileName),
      fileSystem: options.fileSystem,
    });
  } catch (error) {
    options.logger.warn(`이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(error)}`);
  }
}

async function persistGeneratedDraft(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  aiService: StoryboardAiService,
  result: Awaited<ReturnType<SceneGenerationPipeline['run']>>,
  cacheProviders: SceneCacheRecord['providers'],
): Promise<GenerateDraftResult> {
  const { paths, threadPaths, scene, project, draftUri, cacheUri } = inputs;

  // A model that answers with nothing must never cost the author the draft they already have, and
  // must not read as success: no provider is trusted on this.
  if (result.draftBody.trim().length === 0) {
    return { ok: false, kind: 'failed', message: emptyDraftBodyMessage(scene.stem) };
  }

  if (result.dialoguePolish) {
    const { lineCount, polishedCount, contestedCount } = result.dialoguePolish;
    options.logger.info(
      `${scene.stem}: 대사 다듬기 ${polishedCount}/${lineCount}개 손봄${contestedCount > 0 ? `, ${contestedCount}개는 화자가 겹쳐 뼈대 유지` : ''}`,
    );
  }

  const sceneDraftConfig = options.aiGateway.getTaskAiConfig('sceneDraft');
  const draft = createDraft({
    sceneStem: scene.stem,
    format: project.format,
    body: result.draftBody,
    warnings: result.warnings,
    generator: options.generator,
    providerId: sceneDraftConfig.providerId,
    model: sceneDraftConfig.model,
  });

  await options.sceneCacheRepository.ensureDirectory(paths.sceneCacheDirectory);

  options.onSaving?.();

  const bodyHash = computeDraftBodyHash(parseDraft(serializeDraft(draft)).body);
  const cacheRecord = buildSceneCacheRecord(inputs, result, cacheProviders, bodyHash);

  // 우리가 쓴 초안이 아니면(다른 도구의 산출물·사람 수정본) 설정과 무관하게 보관한다. draft/는 기본
  // gitignore이고 keepHistory 기본값이 꺼짐이라, 이 보관이 없으면 되돌릴 곳이 없다.
  const isOurs = await isDraftOursToOverwrite(inputs, options);
  if (!isOurs) {
    options.logger.warn(
      `이 초안은 마지막 생성 결과와 다릅니다(다른 도구로 생성 또는 직접 수정). 덮어쓰기 전에 .draft 히스토리에 보관합니다: ${scene.stem}`,
    );
  }
  await maybeArchiveExistingDraft(inputs, options, !isOurs);

  await options.draftRepository.write(draftUri, draft);

  // 사이드카는 초안이 디스크에 자리잡은 뒤에 쓴다. 먼저 쓰면 살붙임이 실패한 뒤에도 존재하지 않는
  // 초안을 기술하는 기록이 남는다.
  if (result.dialogueRecord) {
    await createSceneDialogueStore(options.fileSystem, threadPaths).save(result.dialogueRecord);
  }

  await options.sceneCacheRepository.write(cacheUri, cacheRecord);

  await updateStoryStateAfterGeneration(inputs, options, aiService, result.draftBody);

  if (options.configBridge.isUpdateCardsAfterGenerateEnabled()) {
    schedulePostGenerationUpdates(inputs, options, aiService, result);
  }

  return {
    ok: true,
    kind: 'generated',
    draftUri,
    warnings: [...inputs.warnings, ...result.warnings],
  };
}

async function runAndPersistDraft(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
): Promise<GenerateDraftResult> {
  const { workspaceFolder, paths, threadPaths, scene, project, context, previousContext } = inputs;

  const aiService = options.aiGateway.createService(workspaceFolder.uri);
  const pipelineProviders = {
    personaGeneration: options.aiGateway.getTaskProvider('personaGeneration'),
    sceneSkeleton: options.aiGateway.getTaskProvider('sceneSkeleton'),
    sceneDialoguePolish: options.aiGateway.getTaskProvider('sceneDialoguePolish'),
    sceneDialogueAttribution: options.aiGateway.getTaskProvider('sceneDialogueAttribution'),
    sceneSectionExpansion: options.aiGateway.getTaskProvider('sceneSectionExpansion'),
  };
  const cacheProviders = {
    ...pipelineProviders,
    traitsExtraction: options.aiGateway.getTaskProvider('traitsExtraction'),
  } satisfies Partial<Record<AiTaskName, AiProviderId>>;

  const backgroundId = context.background?.id;
  const backgroundRecentExcerpt = backgroundId
    ? await findRecentBackgroundExcerpt(options.fileSystem, paths, scene.stem, backgroundId)
    : undefined;

  try {
    const result = await new SceneGenerationPipeline({
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
      useContextCondense: options.configBridge.isAiContextCondenseEnabled(),
      sectionOutputLimit: options.configBridge.getSectionOutputLimit(),
      tuning: options.configBridge.getSceneGenerationTuning(),
      personaStore: createPersonaMemoryStore(options.fileSystem, threadPaths, scene.stem),
      backgroundStore: createBackgroundMemoryStore(options.fileSystem, threadPaths, scene.stem),
      dialogueCorpus: createSceneDialogueStore(options.fileSystem, threadPaths),
      backgroundRecentExcerpt,
    }).run();

    return await persistGeneratedDraft(inputs, options, aiService, result, cacheProviders);
  } catch (error) {
    if (error instanceof SceneGenerationPipelineCancelledError) {
      return { ok: false, kind: 'cancelled' };
    }

    const message = error instanceof Error ? error.message : String(error);
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
  const loaded = await loadSceneGenerationInputs(sceneUri, options);
  if (!loaded.ok) {
    return loaded.result;
  }

  const inputs = loaded.inputs;

  if (
    !options.force &&
    (await isCacheHit(inputs, options))
  ) {
    return await openCachedDraft(inputs.draftUri);
  }

  return await runAndPersistDraft(inputs, options);
}

export class GenerateDraftUseCase implements IUseCase<GenerateDraftRequest, GenerateDraftResult> {
  public constructor(private readonly dependencies: GenerateDraftUseCaseDependencies) {}

  public async execute(request: GenerateDraftRequest): Promise<GenerateDraftResult> {
    return await generateDraftForWorkspaceSceneWorkflow(request.sceneUri, {
      ...this.dependencies,
      ...request,
    });
  }
}
