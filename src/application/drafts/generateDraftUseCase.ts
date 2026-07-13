import * as vscode from 'vscode';

import type { AiGateway } from '../ai/aiGateway';
import type { IFileSystem } from '../ports/fileSystem';
import type {
  IDraftRepository,
  IProjectRepository,
  ISceneCacheRepository,
  ISceneRepository,
} from '../ports/repositories';
import { buildNarrativeContext, buildSceneContext } from '../../core/sceneContext';
import type { StoryboardLogger } from '../../core/logger';
import {
  backgroundCardPath,
  characterCardPath,
  draftHistorySceneDirectory,
  draftPath,
  getStoryboardProjectPaths,
  isDirectSceneTextFile,
} from '../../core/pathConventions';
import { sceneContextPaths } from '../../core/vscodeFileSystem';
import { hasStoryboardProject, uriExists } from '../../core/workspace';
import { createDraft } from '../../files/draft';
import { archiveExistingDraft } from '../../files/draftHistory';
import { SceneParseError } from '../../files/scene';
import { computeSceneInputHash, type SceneCacheRecord } from '../../files/sceneCache';
import { sceneCacheFilePath } from '../../files/sceneCacheWorkspace';
import {
  createBackgroundMemoryStore,
  createPersonaMemoryStore,
} from '../../files/cardMemoryWorkspace';
import { parseSceneFileName } from '../../shared/scene';
import { buildStyleDirective } from '../../shared/styleDirective';
import { type StoryboardAIService } from '../../services/ai/AIService';
import {
  resolveSceneBreakJoiner,
  SceneGenerationPipeline,
  SceneGenerationPipelineCancelledError,
  type SceneGenerationPipelineStage,
} from '../pipelines/sceneGenerationPipeline';
import type { ConfigBridge } from '../../services/settings/ConfigBridge';
import { type TraitsUpdateSummary } from '../../services/ai/traitsUpdater';
import type { PostGenerationUpdateManager } from '../../services/ai/PostGenerationUpdateManager';
import { bibleCandidateFilePath, ensureBibleCacheDirectory } from '../../files/bibleCacheWorkspace';
import { cardCandidateFilePath, ensureCardCacheDirectory } from '../../files/cardCacheWorkspace';
import type { AiProviderId, AiTaskName } from '../../services/ai/types';
import { joinCardText, type BackgroundCard } from '../../shared/card';

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
  cacheUri: vscode.Uri,
  draftUri: vscode.Uri,
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

export interface GenerateDraftUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly configBridge: ConfigBridge;
  readonly draftRepository: IDraftRepository;
  readonly fileSystem: IFileSystem;
  readonly logger: StoryboardLogger;
  readonly postGenerationUpdates?: PostGenerationUpdateManager;
  readonly projectRepository: IProjectRepository;
  readonly sceneCacheRepository: ISceneCacheRepository;
  readonly sceneRepository: ISceneRepository;
}

export interface GenerateDraftRequest {
  readonly force: boolean;
  readonly onPipelineProgress?: (
    stage: SceneGenerationPipelineStage,
    current: number,
    total: number,
  ) => void;
  readonly onSaving?: () => void;
  readonly shouldCancel?: () => boolean;
  readonly suppressLoggerPanel?: boolean;
  readonly onTraitsUpdateComplete?: (summary: TraitsUpdateSummary) => void;
}

export type GenerateDraftResult =
  | { ok: true; kind: 'generated'; draftUri: vscode.Uri }
  | { ok: true; kind: 'cache_hit'; draftUri: vscode.Uri }
  | { ok: false; kind: 'failed'; message: string }
  | { ok: false; kind: 'cancelled' };

type GenerateDraftWorkflowOptions = GenerateDraftUseCaseDependencies & GenerateDraftRequest;

function reportWorkflowFailure(
  options: GenerateDraftWorkflowOptions,
  logMessage: string,
  error: unknown,
  userMessage: string,
): GenerateDraftResult {
  options.logger.error(logMessage, error);

  if (!options.suppressLoggerPanel) {
    options.logger.show();
  }

  return { ok: false, kind: 'failed', message: userMessage };
}

interface SceneGenerationInputs {
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly paths: ReturnType<typeof getStoryboardProjectPaths>;
  readonly scene: Awaited<ReturnType<ISceneRepository['read']>>;
  readonly project: Awaited<ReturnType<IProjectRepository['read']>>;
  readonly context: Awaited<ReturnType<typeof buildSceneContext>>;
  readonly previousContext: string | undefined;
  readonly sceneBreakJoiner: string | undefined;
  readonly inputHash: string;
  readonly draftUri: vscode.Uri;
  readonly cacheUri: vscode.Uri;
}

type SceneGenerationInputsResult =
  | { ok: false; result: GenerateDraftResult }
  | { ok: true; inputs: SceneGenerationInputs };

type SceneGenerationTargetResult =
  | { ok: false; result: GenerateDraftResult }
  | {
      ok: true;
      workspaceFolder: vscode.WorkspaceFolder;
      paths: ReturnType<typeof getStoryboardProjectPaths>;
      fileName: string;
    };

function inputsFailure(message: string): { ok: false; result: GenerateDraftResult } {
  return { ok: false, result: { ok: false, kind: 'failed', message } };
}

async function resolveSceneGenerationTarget(
  sceneUri: vscode.Uri,
): Promise<SceneGenerationTargetResult> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(sceneUri);

  if (!workspaceFolder) {
    return inputsFailure('씬 파일이 속한 워크스페이스 폴더를 찾을 수 없습니다.');
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    return inputsFailure(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
    );
  }

  if (!isDirectSceneTextFile(sceneUri, workspaceFolder)) {
    return inputsFailure(
      'Storyboard 씬 파일만 처리할 수 있습니다. `scene/NN-slug.txt` 형식의 파일을 선택하거나 해당 파일을 편집기에서 연 뒤 다시 시도해 주세요.',
    );
  }

  const fileName = sceneUri.path.split('/').pop() ?? '';

  if (!parseSceneFileName(fileName)) {
    return inputsFailure('씬 파일명은 `NN-slug.txt` 형식이어야 합니다.');
  }

  return {
    ok: true,
    workspaceFolder,
    paths: getStoryboardProjectPaths(workspaceFolder.uri),
    fileName,
  };
}

async function loadSceneGenerationInputs(
  sceneUri: vscode.Uri,
  options: GenerateDraftWorkflowOptions,
): Promise<SceneGenerationInputsResult> {
  const target = await resolveSceneGenerationTarget(sceneUri);
  if (!target.ok) {
    return target;
  }

  const { workspaceFolder, paths, fileName } = target;

  let scene;
  try {
    scene = await options.sceneRepository.read(sceneUri, fileName);
  } catch (error) {
    if (error instanceof SceneParseError) {
      return inputsFailure(`씬 파일을 읽을 수 없습니다: ${error.message}`);
    }

    return {
      ok: false,
      result: reportWorkflowFailure(
        options,
        'Failed to read scene file',
        error,
        '씬 파일을 읽는 중 오류가 발생했습니다. Output 패널을 확인해 주세요.',
      ),
    };
  }

  let project;
  try {
    project = await options.projectRepository.read(paths.projectJson);
  } catch (error) {
    return {
      ok: false,
      result: reportWorkflowFailure(
        options,
        'Failed to read project.json',
        error,
        'project.json을 읽을 수 없습니다. Output 패널을 확인해 주세요.',
      ),
    };
  }

  const ctxPaths = sceneContextPaths(paths);
  let context;
  try {
    context = await buildSceneContext(ctxPaths, scene, options.fileSystem);
  } catch (error) {
    return {
      ok: false,
      result: reportWorkflowFailure(
        options,
        'Failed to build scene context',
        error,
        '씬 컨텍스트를 구성하지 못했습니다. Output 패널을 확인해 주세요.',
      ),
    };
  }

  const narrativeContext = await buildNarrativeContext(ctxPaths, context, options.fileSystem);
  const sceneBreakJoiner = resolveSceneBreakJoiner(
    options.configBridge.getDraftSceneBreakSeparator(),
  );
  const inputHash = computeSceneInputHash({
    sceneBody: context.scene.body,
    characters: context.characters,
    background: context.background,
    format: project.format,
    bibleFacts: narrativeContext.bibleFacts,
    sceneBreakJoiner,
  });

  return {
    ok: true,
    inputs: {
      workspaceFolder,
      paths,
      scene,
      project,
      context,
      previousContext: narrativeContext.prompt,
      sceneBreakJoiner,
      inputHash,
      draftUri: draftPath(workspaceFolder.uri, scene.stem),
      cacheUri: sceneCacheFilePath(paths, scene.stem),
    },
  };
}

async function openCachedDraft(draftUri: vscode.Uri): Promise<GenerateDraftResult> {
  return { ok: true, kind: 'cache_hit', draftUri };
}

function schedulePostGenerationUpdates(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  aiService: StoryboardAIService,
  result: Awaited<ReturnType<SceneGenerationPipeline['run']>>,
): void {
  const { workspaceFolder, paths, scene, context } = inputs;
  const updates = options.postGenerationUpdates;

  if (!updates) {
    return;
  }

  const detectedCharacterCards = context.characters.filter((card) =>
    result.detectedCharacters.includes(card.name),
  );

  updates.scheduleCharacterTraits({
    queueKey: workspaceFolder.uri.toString(),
    sceneStem: scene.stem,
    draftBody: result.draftBody,
    detectedCharacterCards,
    aiService,
    fileSystem: options.fileSystem,
    resolveCharacterCardUri: (card) => characterCardPath(workspaceFolder.uri, card.id),
    logger: options.logger,
    onComplete: options.onTraitsUpdateComplete,
  });

  updates.scheduleBibleCandidates({
    queueKey: `${workspaceFolder.uri.toString()}#bible`,
    sceneStem: scene.stem,
    draftBody: result.draftBody,
    detectedCharacterCards,
    aiService,
    fileSystem: options.fileSystem,
    ensureDirectory: () => ensureBibleCacheDirectory(paths),
    resolveCandidateUri: (stem) => bibleCandidateFilePath(paths, stem),
    logger: options.logger,
  });

  updates.scheduleCardCandidates({
    queueKey: `${workspaceFolder.uri.toString()}#cards`,
    sceneStem: scene.stem,
    draftBody: result.draftBody,
    detectedCharacterCards,
    characterRoster: context.characters.map((card) => ({ id: card.id, name: card.name })),
    aiService,
    verify: options.configBridge.isVerifyCardCandidatesEnabled(),
    fileSystem: options.fileSystem,
    ensureDirectory: () => ensureCardCacheDirectory(paths),
    resolveCandidateUri: (stem) => cardCandidateFilePath(paths, stem),
    logger: options.logger,
  });

  if (context.background) {
    updates.scheduleBackgroundCharacters({
      queueKey: `${workspaceFolder.uri.toString()}#background`,
      backgroundId: context.background.id,
      detectedCharacterCards,
      fileSystem: options.fileSystem,
      resolveBackgroundCardUri: (backgroundId) =>
        backgroundCardPath(workspaceFolder.uri, backgroundId),
      logger: options.logger,
    });
  }
}

function buildSceneCacheRecord(
  inputs: SceneGenerationInputs,
  result: Awaited<ReturnType<SceneGenerationPipeline['run']>>,
  providers: SceneCacheRecord['providers'],
): SceneCacheRecord {
  const { scene, context, previousContext, inputHash } = inputs;

  return {
    sceneStem: scene.stem,
    generatedAt: new Date().toISOString(),
    inputHash,
    input: context.scene.body,
    detectedCharacters: result.detectedCharacters,
    extractedSituations: result.situations.map((item) => ({
      summary: item.situation,
      characters: [...item.characters],
    })),
    personasUsed: Object.fromEntries(result.personasUsed),
    backgroundSnapshot: toBackgroundSnapshot(context.background),
    previousContext,
    providers,
  };
}

async function maybeArchiveExistingDraft(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
): Promise<void> {
  if (!options.configBridge.isKeepDraftHistoryEnabled()) {
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
      resolveArchiveUri: (fileName) => vscode.Uri.joinPath(historyDirectory, fileName),
      fileSystem: options.fileSystem,
    });
  } catch (error) {
    options.logger.warn(`이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(error)}`);
  }
}

async function runAndPersistDraft(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
): Promise<GenerateDraftResult> {
  const { workspaceFolder, paths, scene, project, context, previousContext, draftUri, cacheUri } =
    inputs;

  const aiService = options.aiGateway.createService(workspaceFolder.uri);
  const pipelineProviders = {
    situationExtraction: options.aiGateway.getTaskProvider('situationExtraction'),
    personaGeneration: options.aiGateway.getTaskProvider('personaGeneration'),
    personaDialogue: options.aiGateway.getTaskProvider('personaDialogue'),
    sceneDraft: options.aiGateway.getTaskProvider('sceneDraft'),
  };
  const cacheProviders = {
    ...pipelineProviders,
    traitsExtraction: options.aiGateway.getTaskProvider('traitsExtraction'),
  } satisfies Partial<Record<AiTaskName, AiProviderId>>;

  try {
    const result = await new SceneGenerationPipeline({
      sceneStem: scene.stem,
      context,
      aiService,
      format: project.format,
      styleDirective: buildStyleDirective(project.setting, scene.frontmatter.relationStage),
      previousContext,
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
      sceneBreakJoiner: inputs.sceneBreakJoiner,
    }).run();

    const draft = createDraft({
      sceneStem: scene.stem,
      format: project.format,
      body: result.draftBody,
    });

    await options.sceneCacheRepository.ensureDirectory(paths.sceneCacheDirectory);

    options.onSaving?.();

    const cacheRecord = buildSceneCacheRecord(inputs, result, cacheProviders);

    await maybeArchiveExistingDraft(inputs, options);

    await options.draftRepository.write(draftUri, draft);
    await options.sceneCacheRepository.write(cacheUri, cacheRecord);

    if (options.configBridge.isUpdateCardsAfterGenerateEnabled()) {
      schedulePostGenerationUpdates(inputs, options, aiService, result);
    }

    return { ok: true, kind: 'generated', draftUri };
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
  sceneUri: vscode.Uri,
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
    sceneUri: vscode.Uri,
    request: GenerateDraftRequest,
  ): Promise<GenerateDraftResult> {
    return await generateDraftForWorkspaceSceneWorkflow(sceneUri, {
      ...this.dependencies,
      ...request,
    });
  }
}
