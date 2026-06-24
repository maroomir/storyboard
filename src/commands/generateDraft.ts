import * as vscode from "vscode"

import { buildNarrativeContext, buildSceneContext } from "../core/sceneContext"
import type { StoryboardLogger } from "../core/logger"
import {
  characterCardPath,
  draftPath,
  getStoryboardProjectPaths,
  isDirectSceneTextFile
} from "../core/pathConventions"
import { sceneContextFileSystem, sceneContextPaths, vscodeFsAdapter } from "../core/vscodeFileSystem"
import { hasStoryboardProject, uriExists } from "../core/workspace"
import { createDraft, writeDraftFile } from "../files/draft"
import { readProjectJson } from "../files/projectJson"
import { readSceneFile, SceneParseError } from "../files/scene"
import {
  computeSceneInputHash,
  readSceneCacheFile,
  writeSceneCacheFile,
  type SceneCacheRecord
} from "../files/sceneCache"
import { ensureSceneCacheDirectory, sceneCacheFilePath } from "../files/sceneCacheWorkspace"
import { createBackgroundMemoryStore, createPersonaMemoryStore } from "../files/cardMemoryWorkspace"
import { parseSceneFileName } from "../shared/scene"
import { buildStyleDirective } from "../shared/styleDirective"
import { maybeRunReviseAfterGenerate } from "./reviseDraft"
import { StoryboardAIService } from "../services/ai/AIService"
import {
  runSceneGenerationPipeline,
  SceneGenerationPipelineCancelledError,
  type SceneGenerationPipelineStage
} from "../services/ai/pipelines/sceneGenerationPipeline"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import type { ConfigBridge } from "../services/settings/ConfigBridge"
import { scheduleCharacterTraitsUpdate, type TraitsUpdateSummary } from "../services/ai/traitsUpdater"
import { scheduleBibleCandidateUpdate } from "../services/ai/bibleCandidateUpdater"
import { bibleCandidateFilePath, ensureBibleCacheDirectory } from "../files/bibleCacheWorkspace"
import { recordUsageSafely } from "../services/ai/recordUsageSafely"
import type { UsageRecorder } from "../services/ai/UsageRecorder"
import type { AiProviderId, AiTaskName } from "../services/ai/types"
import type { BackgroundCard } from "../shared/card"

const generateDraftCommand = "storyboard.draft.generate"
const regenerateDraftCommand = "storyboard.draft.regenerate"

const cacheHitMessage = "입력이 동일하여 캐시된 초안을 엽니다."
const regenerateSuccessMessage = "초안을 다시 생성해 저장했습니다."
const generateSuccessMessage = "초안을 생성해 저장했습니다."

function resolveSceneUriFromInvocation(invokedUri?: vscode.Uri): vscode.Uri | undefined {
  if (invokedUri && invokedUri.scheme === "file") {
    return invokedUri
  }

  const editor = vscode.window.activeTextEditor
  const doc = editor?.document

  if (!doc || doc.uri.scheme !== "file") {
    return undefined
  }

  return doc.uri
}

export function stageProgressLabel(stage: SceneGenerationPipelineStage): string {
  switch (stage) {
    case "extractSituations":
      return "상황 추출"
    case "buildPersonas":
      return "페르소나 준비"
    case "generateDialogue":
      return "대화 생성"
    case "applyFormat":
      return "장르 포맷 적용"
    default:
      return "처리 중"
  }
}

function toBackgroundSnapshot(
  background: BackgroundCard | undefined
): SceneCacheRecord["backgroundSnapshot"] {
  if (!background) {
    return undefined
  }

  return {
    id: background.id,
    name: background.name,
    description: background.description
  }
}

async function isCacheHit(
  cacheUri: vscode.Uri,
  draftUri: vscode.Uri,
  inputHash: string
): Promise<boolean> {
  if (!(await uriExists(cacheUri)) || !(await uriExists(draftUri))) {
    return false
  }

  try {
    const record = await readSceneCacheFile(cacheUri, vscodeFsAdapter)
    return record.inputHash === inputHash
  } catch {
    return false
  }
}

export interface RegisterGenerateDraftCommandDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly configBridge: ConfigBridge
  readonly logger: StoryboardLogger
  readonly usageRecorder: UsageRecorder
}

export interface RunGenerateDraftForWorkspaceSceneOptions {
  readonly force: boolean
  readonly aiProviderRegistry: AiProviderRegistry
  readonly configBridge: ConfigBridge
  readonly logger: StoryboardLogger
  readonly usageRecorder: UsageRecorder
}

export type GenerateDraftWorkflowResult =
  | { ok: true; kind: "generated" }
  | { ok: true; kind: "cache_hit" }
  | { ok: false; kind: "failed"; message: string }
  | { ok: false; kind: "cancelled" }

export interface GenerateDraftWorkflowOptions {
  readonly force: boolean
  readonly aiProviderRegistry: AiProviderRegistry
  readonly configBridge: ConfigBridge
  readonly logger: StoryboardLogger
  readonly usageRecorder: UsageRecorder
  readonly openDocumentOnSuccess: boolean
  readonly showCacheHitMessage: boolean
  readonly showSuccessMessage: boolean
  readonly onPipelineProgress?: (stage: SceneGenerationPipelineStage, current: number, total: number) => void
  readonly onSaving?: () => void
  readonly shouldCancel?: () => boolean
  readonly suppressLoggerPanel?: boolean
  readonly onTraitsUpdateComplete?: (summary: TraitsUpdateSummary) => void
}

function reportWorkflowFailure(
  options: GenerateDraftWorkflowOptions,
  logMessage: string,
  error: unknown,
  userMessage: string
): GenerateDraftWorkflowResult {
  options.logger.error(logMessage, error)

  if (!options.suppressLoggerPanel) {
    options.logger.show()
  }

  return { ok: false, kind: "failed", message: userMessage }
}

interface SceneGenerationInputs {
  readonly workspaceFolder: vscode.WorkspaceFolder
  readonly paths: ReturnType<typeof getStoryboardProjectPaths>
  readonly scene: Awaited<ReturnType<typeof readSceneFile>>
  readonly project: Awaited<ReturnType<typeof readProjectJson>>
  readonly context: Awaited<ReturnType<typeof buildSceneContext>>
  readonly previousContext: string | undefined
  readonly inputHash: string
  readonly draftUri: vscode.Uri
  readonly cacheUri: vscode.Uri
}

type SceneGenerationInputsResult =
  | { ok: false; result: GenerateDraftWorkflowResult }
  | { ok: true; inputs: SceneGenerationInputs }

type SceneGenerationTargetResult =
  | { ok: false; result: GenerateDraftWorkflowResult }
  | {
      ok: true
      workspaceFolder: vscode.WorkspaceFolder
      paths: ReturnType<typeof getStoryboardProjectPaths>
      fileName: string
    }

function inputsFailure(message: string): { ok: false; result: GenerateDraftWorkflowResult } {
  return { ok: false, result: { ok: false, kind: "failed", message } }
}

async function resolveSceneGenerationTarget(
  sceneUri: vscode.Uri
): Promise<SceneGenerationTargetResult> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(sceneUri)

  if (!workspaceFolder) {
    return inputsFailure("씬 파일이 속한 워크스페이스 폴더를 찾을 수 없습니다.")
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    return inputsFailure("Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.")
  }

  if (!isDirectSceneTextFile(sceneUri, workspaceFolder)) {
    return inputsFailure(
      "Storyboard 씬 파일만 처리할 수 있습니다. `scene/NN-slug.txt` 형식의 파일을 선택하거나 해당 파일을 편집기에서 연 뒤 다시 시도해 주세요."
    )
  }

  const fileName = sceneUri.path.split("/").pop() ?? ""

  if (!parseSceneFileName(fileName)) {
    return inputsFailure("씬 파일명은 `NN-slug.txt` 형식이어야 합니다.")
  }

  return { ok: true, workspaceFolder, paths: getStoryboardProjectPaths(workspaceFolder.uri), fileName }
}

async function loadSceneGenerationInputs(
  sceneUri: vscode.Uri,
  options: GenerateDraftWorkflowOptions
): Promise<SceneGenerationInputsResult> {
  const target = await resolveSceneGenerationTarget(sceneUri)
  if (!target.ok) {
    return target
  }

  const { workspaceFolder, paths, fileName } = target

  let scene
  try {
    scene = await readSceneFile(sceneUri, vscodeFsAdapter, fileName)
  } catch (error) {
    if (error instanceof SceneParseError) {
      return inputsFailure(`씬 파일을 읽을 수 없습니다: ${error.message}`)
    }

    return {
      ok: false,
      result: reportWorkflowFailure(
        options,
        "Failed to read scene file",
        error,
        "씬 파일을 읽는 중 오류가 발생했습니다. Output 패널을 확인해 주세요."
      )
    }
  }

  let project
  try {
    project = await readProjectJson(paths.projectJson)
  } catch (error) {
    return {
      ok: false,
      result: reportWorkflowFailure(
        options,
        "Failed to read project.json",
        error,
        "project.json을 읽을 수 없습니다. Output 패널을 확인해 주세요."
      )
    }
  }

  const ctxPaths = sceneContextPaths(paths)
  let context
  try {
    context = await buildSceneContext(ctxPaths, scene, sceneContextFileSystem)
  } catch (error) {
    return {
      ok: false,
      result: reportWorkflowFailure(
        options,
        "Failed to build scene context",
        error,
        "씬 컨텍스트를 구성하지 못했습니다. Output 패널을 확인해 주세요."
      )
    }
  }

  const narrativeContext = await buildNarrativeContext(ctxPaths, context, sceneContextFileSystem)
  const inputHash = computeSceneInputHash({
    sceneBody: context.scene.body,
    characters: context.characters,
    background: context.background,
    format: project.format,
    bibleFacts: narrativeContext.bibleFacts
  })

  return {
    ok: true,
    inputs: {
      workspaceFolder,
      paths,
      scene,
      project,
      context,
      previousContext: narrativeContext.prompt,
      inputHash,
      draftUri: draftPath(workspaceFolder.uri, scene.stem),
      cacheUri: sceneCacheFilePath(paths, scene.stem)
    }
  }
}

async function openDraftDocument(draftUri: vscode.Uri): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(draftUri)
  await vscode.window.showTextDocument(doc)
}

async function openCachedDraft(
  draftUri: vscode.Uri,
  options: GenerateDraftWorkflowOptions
): Promise<GenerateDraftWorkflowResult> {
  if (options.showCacheHitMessage) {
    await vscode.window.showInformationMessage(cacheHitMessage)
  }

  if (options.openDocumentOnSuccess) {
    await openDraftDocument(draftUri)
  }

  return { ok: true, kind: "cache_hit" }
}

function schedulePostGenerationUpdates(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions,
  aiService: StoryboardAIService,
  result: Awaited<ReturnType<typeof runSceneGenerationPipeline>>
): void {
  const { workspaceFolder, paths, scene, context } = inputs

  const detectedCharacterCards = context.characters.filter((card) =>
    result.detectedCharacters.includes(card.name)
  )

  scheduleCharacterTraitsUpdate({
    queueKey: workspaceFolder.uri.toString(),
    sceneStem: scene.stem,
    draftBody: result.draftBody,
    detectedCharacterCards,
    aiService,
    fileSystem: vscodeFsAdapter,
    resolveCharacterCardUri: (card) => characterCardPath(workspaceFolder.uri, card.id),
    logger: options.logger,
    onComplete: options.onTraitsUpdateComplete
  })

  scheduleBibleCandidateUpdate({
    queueKey: `${workspaceFolder.uri.toString()}#bible`,
    sceneStem: scene.stem,
    draftBody: result.draftBody,
    detectedCharacterCards,
    aiService,
    fileSystem: vscodeFsAdapter,
    ensureDirectory: () => ensureBibleCacheDirectory(paths),
    resolveCandidateUri: (stem) => bibleCandidateFilePath(paths, stem),
    logger: options.logger
  })
}

function buildSceneCacheRecord(
  inputs: SceneGenerationInputs,
  result: Awaited<ReturnType<typeof runSceneGenerationPipeline>>,
  providers: SceneCacheRecord["providers"]
): SceneCacheRecord {
  const { scene, context, previousContext, inputHash } = inputs

  return {
    sceneStem: scene.stem,
    generatedAt: new Date().toISOString(),
    inputHash,
    input: context.scene.body,
    detectedCharacters: result.detectedCharacters,
    extractedSituations: result.situations.map((item) => ({
      summary: item.situation,
      characters: [...item.characters]
    })),
    personasUsed: Object.fromEntries(result.personasUsed),
    backgroundSnapshot: toBackgroundSnapshot(context.background),
    previousContext,
    providers
  }
}

async function runAndPersistDraft(
  inputs: SceneGenerationInputs,
  options: GenerateDraftWorkflowOptions
): Promise<GenerateDraftWorkflowResult> {
  const { workspaceFolder, paths, scene, project, context, previousContext, draftUri, cacheUri } = inputs

  const aiService = new StoryboardAIService(options.aiProviderRegistry, {
    onUsage: (record): void => {
      recordUsageSafely(options.usageRecorder, workspaceFolder.uri, record, options.logger)
    }
  })
  const pipelineProviders = {
    situationExtraction: options.aiProviderRegistry.getTaskProvider("situationExtraction"),
    personaGeneration: options.aiProviderRegistry.getTaskProvider("personaGeneration"),
    personaDialogue: options.aiProviderRegistry.getTaskProvider("personaDialogue"),
    sceneDraft: options.aiProviderRegistry.getTaskProvider("sceneDraft")
  }
  const cacheProviders = {
    ...pipelineProviders,
    traitsExtraction: options.aiProviderRegistry.getTaskProvider("traitsExtraction")
  } satisfies Partial<Record<AiTaskName, AiProviderId>>

  try {
    const result = await runSceneGenerationPipeline({
      sceneStem: scene.stem,
      context,
      aiService,
      format: project.format,
      styleDirective: buildStyleDirective(project.setting, scene.frontmatter.relationStage),
      previousContext,
      providers: pipelineProviders,
      onProgress: (stage, current, total) => {
        if (options.shouldCancel?.()) {
          return
        }

        options.onPipelineProgress?.(stage, current, total)
      },
      shouldCancel: options.shouldCancel,
      useContextCondense: options.configBridge.isAiContextCondenseEnabled(),
      personaStore: createPersonaMemoryStore(paths, scene.stem),
      backgroundStore: createBackgroundMemoryStore(paths, scene.stem)
    })

    const draft = createDraft({
      sceneStem: scene.stem,
      format: project.format,
      body: result.draftBody
    })

    await ensureSceneCacheDirectory(paths)

    options.onSaving?.()

    const cacheRecord = buildSceneCacheRecord(inputs, result, cacheProviders)

    await writeDraftFile(draftUri, vscodeFsAdapter, draft)
    await writeSceneCacheFile(cacheUri, vscodeFsAdapter, cacheRecord)

    if (options.configBridge.isUpdateCardsAfterGenerateEnabled()) {
      schedulePostGenerationUpdates(inputs, options, aiService, result)
    }

    if (options.openDocumentOnSuccess) {
      await openDraftDocument(draftUri)
    }

    if (options.showSuccessMessage) {
      await vscode.window.showInformationMessage(
        options.force ? regenerateSuccessMessage : generateSuccessMessage
      )
    }

    return { ok: true, kind: "generated" }
  } catch (error) {
    if (error instanceof SceneGenerationPipelineCancelledError) {
      return { ok: false, kind: "cancelled" }
    }

    const message = error instanceof Error ? error.message : String(error)
    return reportWorkflowFailure(options, "Draft generation failed", error, `초안 생성에 실패했습니다: ${message}`)
  }
}

export async function generateDraftForWorkspaceSceneWorkflow(
  sceneUri: vscode.Uri,
  options: GenerateDraftWorkflowOptions
): Promise<GenerateDraftWorkflowResult> {
  const loaded = await loadSceneGenerationInputs(sceneUri, options)
  if (!loaded.ok) {
    return loaded.result
  }

  const inputs = loaded.inputs

  if (!options.force && (await isCacheHit(inputs.cacheUri, inputs.draftUri, inputs.inputHash))) {
    return await openCachedDraft(inputs.draftUri, options)
  }

  return await runAndPersistDraft(inputs, options)
}

export async function runGenerateDraftForWorkspaceScene(
  sceneUri: vscode.Uri,
  options: RunGenerateDraftForWorkspaceSceneOptions
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: options.force ? "Storyboard 초안 다시 생성" : "Storyboard 초안 생성",
      cancellable: true
    },
    async (progress, token) => {
      progress.report({ message: "준비 중…" })

      const result = await generateDraftForWorkspaceSceneWorkflow(sceneUri, {
        force: options.force,
        aiProviderRegistry: options.aiProviderRegistry,
        configBridge: options.configBridge,
        logger: options.logger,
        usageRecorder: options.usageRecorder,
        openDocumentOnSuccess: true,
        showCacheHitMessage: false,
        showSuccessMessage: false,
        onTraitsUpdateComplete: (summary) => {
          if (summary.updatedCardCount > 0) {
            void vscode.window.showInformationMessage(
              `캐릭터 카드 ${summary.updatedCardCount}개에 특성·최근 대사를 반영했습니다.`
            )
          }
        },
        onPipelineProgress: (stage, current, total) => {
          if (token.isCancellationRequested) {
            return
          }

          const label = stageProgressLabel(stage)
          progress.report({
            message: total > 1 ? `${label} (${current}/${total})…` : `${label}…`
          })
        },
        onSaving: () => {
          if (!token.isCancellationRequested) {
            progress.report({ message: "파일 저장 중…" })
          }
        },
        shouldCancel: () => token.isCancellationRequested
      })

      if (result.ok) {
        if (result.kind === "generated") {
          await maybeRunReviseAfterGenerate(
            sceneUri,
            options.configBridge,
            {
              aiProviderRegistry: options.aiProviderRegistry,
              usageRecorder: options.usageRecorder,
              logger: options.logger
            },
            {
              onProgress: (message) => progress.report({ message }),
              shouldCancel: () => token.isCancellationRequested
            }
          )
        }

        progress.report({
          message: result.kind === "cache_hit" ? "캐시된 초안을 열었습니다." : "완료"
        })
        if (result.kind === "cache_hit") {
          void vscode.window.showInformationMessage(cacheHitMessage)
        } else {
          void vscode.window.showInformationMessage(
            options.force ? regenerateSuccessMessage : generateSuccessMessage
          )
        }
        return
      }

      if (result.kind === "cancelled") {
        return
      }

      void vscode.window.showErrorMessage(result.message)
    }
  )
}

async function runCommand(
  invokedUri: vscode.Uri | undefined,
  force: boolean,
  dependencies: RegisterGenerateDraftCommandDependencies
): Promise<void> {
  const sceneUri = resolveSceneUriFromInvocation(invokedUri)

  if (!sceneUri) {
    await vscode.window.showErrorMessage(
      "씬 파일 URI가 없습니다. `scene` 폴더의 `.txt` 파일을 열거나 탐색기에서 명령을 실행해 주세요."
    )
    return
  }

  await runGenerateDraftForWorkspaceScene(sceneUri, {
    force,
    aiProviderRegistry: dependencies.aiProviderRegistry,
    configBridge: dependencies.configBridge,
    logger: dependencies.logger,
    usageRecorder: dependencies.usageRecorder
  })
}

export function registerGenerateDraftCommands(
  dependencies: RegisterGenerateDraftCommandDependencies
): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand(generateDraftCommand, (uri?: vscode.Uri) =>
      runCommand(uri, false, dependencies)
    ),
    vscode.commands.registerCommand(regenerateDraftCommand, (uri?: vscode.Uri) =>
      runCommand(uri, true, dependencies)
    )
  )
}
