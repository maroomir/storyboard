import type { ISceneCacheRepository, StoryUri } from '@storyboard/story-engine';
import { draftHistorySceneDirectory, joinUri } from '@storyboard/story-engine';
import { uriExists } from '../../infrastructure/vscode/workspace';
import {
  computeDraftBodyHash,
  createDraft,
  joinCardText,
  parseDraft,
  serializeDraft,
} from '@storyboard/story-format';
import type { BackgroundCard } from '@storyboard/story-format';
import { archiveExistingDraft } from '@storyboard/story-engine';
import { type SceneCacheRecord } from '@storyboard/story-engine';
import {
  createBackgroundMemoryStore,
  createPersonaMemoryStore,
  createSceneDialogueStore,
} from '../../infrastructure/persistence/cardMemoryWorkspace';
import { findRecentBackgroundExcerpt } from '../../infrastructure/persistence/backgroundExcerpt';
import { buildStyleDirective } from '@storyboard/story-ai';
import type { AiProviderId, AiTaskName, StoryboardAIService } from '@storyboard/story-ai';
import {
  SceneGenerationPipeline,
  SceneGenerationPipelineCancelledError,
} from '@storyboard/story-pipeline';
import type {
  GenerateDraftRequest,
  GenerateDraftResult,
  GenerateDraftUseCaseDependencies,
  GenerateDraftWorkflowOptions,
} from './generateDraftTypes';
import {
  loadSceneGenerationInputs,
  reportWorkflowFailure,
  type SceneGenerationInputs,
} from './sceneGenerationInputs';
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

async function isCacheHit(
  cacheUri: StoryUri,
  draftUri: StoryUri,
  inputHash: string,
  sceneCacheRepository: ISceneCacheRepository,
): Promise<boolean> {
  if (!(await uriExists(cacheUri)) || !(await uriExists(draftUri))) {
    return false;
  }

  try {
    const record = await sceneCacheRepository.read(cacheUri);
    return record.inputHash === inputHash;
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

// NOTE: 디스크의 초안이 우리가 마지막으로 쓴 그것인지 판정한다. 봇이 쓴 초안이나 사람이 고친
// 초안은 여기서 거짓이 되고, 그런 초안은 히스토리 설정과 무관하게 보관한 뒤에만 덮어쓴다.
// 봇은 씬 캐시를 쓰지 않으므로 기록 자체가 없고, 구버전 기록에는 bodyHash가 없다 — 둘 다
// 판정 불가이므로 보수적으로 보관한다.
async function isDraftOursToOverwrite(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
): Promise<boolean> {
  if (!(await uriExists(inputs.draftUri))) {
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
  aiService: StoryboardAIService,
  result: Awaited<ReturnType<SceneGenerationPipeline['run']>>,
  cacheProviders: SceneCacheRecord['providers'],
): Promise<GenerateDraftResult> {
  const { paths, scene, project, draftUri, cacheUri } = inputs;

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

  // 우리가 쓴 초안이 아니면(봇 산출물·사람 수정본) 설정과 무관하게 보관한다. draft/는 기본
  // gitignore이고 keepHistory 기본값이 꺼짐이라, 이 보관이 없으면 되돌릴 곳이 없다.
  const isOurs = await isDraftOursToOverwrite(inputs, options);
  if (!isOurs) {
    options.logger.warn(
      `이 초안은 마지막 생성 결과와 다릅니다(봇 생성 또는 직접 수정). 덮어쓰기 전에 .draft 히스토리에 보관합니다: ${scene.stem}`,
    );
  }
  await maybeArchiveExistingDraft(inputs, options, !isOurs);

  await options.draftRepository.write(draftUri, draft);

  // 사이드카는 초안이 디스크에 자리잡은 뒤에 쓴다. 먼저 쓰면 살붙임이 실패한 뒤에도 존재하지 않는
  // 초안을 기술하는 기록이 남는다.
  if (result.dialogueRecord) {
    await createSceneDialogueStore(paths).save(result.dialogueRecord);
  }

  await options.sceneCacheRepository.write(cacheUri, cacheRecord);

  await updateStoryStateAfterGeneration(inputs, options, aiService, result.draftBody);

  if (options.configBridge.isUpdateCardsAfterGenerateEnabled()) {
    schedulePostGenerationUpdates(inputs, options, aiService, result);
  }

  return { ok: true, kind: 'generated', draftUri };
}

async function runAndPersistDraft(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
): Promise<GenerateDraftResult> {
  const { workspaceFolder, paths, scene, project, context, previousContext } = inputs;

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
    ? await findRecentBackgroundExcerpt(paths, scene.stem, backgroundId)
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
        scene.frontmatter.povCharacter,
      ),
      previousContext,
      canonFactLines: inputs.canonFactLines,
      providers: pipelineProviders,
      onProgress: (stage, current, total): void => {
        if (options.shouldCancel?.()) {
          return;
        }

        options.onPipelineProgress?.(stage, current, total);
      },
      shouldCancel: options.shouldCancel,
      useContextCondense: options.configBridge.isAiContextCondenseEnabled(),
      personaStore: createPersonaMemoryStore(paths, scene.stem),
      backgroundStore: createBackgroundMemoryStore(paths, scene.stem),
      dialogueCorpus: createSceneDialogueStore(paths),
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
    (await isCacheHit(
      inputs.cacheUri,
      inputs.draftUri,
      inputs.inputHash,
      options.sceneCacheRepository,
    ))
  ) {
    return await openCachedDraft(inputs.draftUri);
  }

  return await runAndPersistDraft(inputs, options);
}

export class GenerateDraftUseCase {
  public constructor(private readonly dependencies: GenerateDraftUseCaseDependencies) {}

  public async execute(
    sceneUri: StoryUri,
    request: GenerateDraftRequest,
  ): Promise<GenerateDraftResult> {
    return await generateDraftForWorkspaceSceneWorkflow(sceneUri, {
      ...this.dependencies,
      ...request,
    });
  }
}
