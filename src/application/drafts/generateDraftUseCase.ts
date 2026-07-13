import * as vscode from 'vscode';

import type { ISceneCacheRepository } from '../ports/repositories';
import { draftHistorySceneDirectory } from '../../core/pathConventions';
import { uriExists } from '../../core/workspace';
import { createDraft } from '../../files/draft';
import { archiveExistingDraft } from '../../files/draftHistory';
import { type SceneCacheRecord } from '../../files/sceneCache';
import {
  createBackgroundMemoryStore,
  createPersonaMemoryStore,
} from '../../files/cardMemoryWorkspace';
import { buildStyleDirective } from '../../shared/styleDirective';
import {
  SceneGenerationPipeline,
  SceneGenerationPipelineCancelledError,
} from '../pipelines/sceneGenerationPipeline';
import type { AiProviderId, AiTaskName } from '../../services/ai/types';
import { joinCardText, type BackgroundCard } from '../../shared/card';
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

async function openCachedDraft(draftUri: vscode.Uri): Promise<GenerateDraftResult> {
  return { ok: true, kind: 'cache_hit', draftUri };
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
