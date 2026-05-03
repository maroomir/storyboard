import * as vscode from "vscode"

import {
  buildSceneContext,
  readPreviousSceneContext,
  type SceneContextWorkspaceFileSystem,
  type SceneContextWorkspacePaths
} from "../core/sceneContext"
import type { StoryboardLogger } from "../core/logger"
import {
  characterCardPath,
  draftPath,
  getStoryboardProjectPaths,
  type StoryboardProjectPaths
} from "../core/pathConventions"
import { hasStoryboardProject, uriExists } from "../core/workspace"
import { createDraft, writeDraftFile, type DraftFileSystem } from "../files/draft"
import { readProjectJson } from "../files/projectJson"
import { readSceneFile, SceneParseError } from "../files/scene"
import {
  computeSceneInputHash,
  readSceneCacheFile,
  writeSceneCacheFile,
  type SceneCacheFileSystem,
  type SceneCacheRecord
} from "../files/sceneCache"
import { ensureSceneCacheDirectory, sceneCacheFilePath } from "../files/sceneCacheWorkspace"
import { parseSceneFileName } from "../shared/scene"
import { StoryboardAIService } from "../services/ai/AIService"
import {
  runSceneGenerationPipeline,
  SceneGenerationPipelineCancelledError,
  type SceneGenerationPipelineStage
} from "../services/ai/pipelines/sceneGenerationPipeline"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import { scheduleCharacterTraitsUpdate, type TraitsUpdateSummary } from "../services/ai/traitsUpdater"
import type { AiProviderId, AiTaskName } from "../services/ai/types"
import type { BackgroundCard } from "../shared/card"

const generateDraftCommand = "storyboard.draft.generate"
const regenerateDraftCommand = "storyboard.draft.regenerate"

const vscodeFsAdapter: SceneCacheFileSystem & DraftFileSystem = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

const sceneContextFileSystem: SceneContextWorkspaceFileSystem = {
  readFile: vscodeFsAdapter.readFile,
  writeFile: vscodeFsAdapter.writeFile,
  readDirectory: async (
    uri: unknown
  ): Promise<[string, { type: "file" | "directory" }][]> => {
    const entries = await vscode.workspace.fs.readDirectory(uri as vscode.Uri)
    return entries.map(([name, fileType]) => [
      name,
      { type: fileType === vscode.FileType.Directory ? ("directory" as const) : ("file" as const) }
    ])
  }
}

function sceneContextPaths(paths: StoryboardProjectPaths): SceneContextWorkspacePaths {
  return {
    characterDirectory: paths.characterDirectory,
    backgroundDirectory: paths.backgroundDirectory,
    draftDirectory: paths.draftDirectory,
    joinPath: (base: unknown, ...segments: string[]): vscode.Uri =>
      vscode.Uri.joinPath(base as vscode.Uri, ...segments)
  }
}

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

function isDirectSceneTextFile(sceneUri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): boolean {
  const sceneDir = vscode.Uri.joinPath(workspaceFolder.uri, "scene")
  const dirPath = sceneDir.fsPath.replace(/\\/g, "/").toLowerCase()
  const filePath = sceneUri.fsPath.replace(/\\/g, "/").toLowerCase()

  if (!filePath.startsWith(`${dirPath}/`)) {
    return false
  }

  const remainder = filePath.slice(dirPath.length + 1)
  return !remainder.includes("/") && remainder.endsWith(".txt")
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
    description: background.description,
    country: background.country,
    category: background.category
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
  readonly logger: StoryboardLogger
}

export interface RunGenerateDraftForWorkspaceSceneOptions {
  readonly force: boolean
  readonly aiProviderRegistry: AiProviderRegistry
  readonly logger: StoryboardLogger
}

export type GenerateDraftWorkflowResult =
  | { ok: true; kind: "generated" }
  | { ok: true; kind: "cache_hit" }
  | { ok: false; kind: "failed"; message: string }
  | { ok: false; kind: "cancelled" }

export interface GenerateDraftWorkflowOptions {
  readonly force: boolean
  readonly aiProviderRegistry: AiProviderRegistry
  readonly logger: StoryboardLogger
  readonly openDocumentOnSuccess: boolean
  readonly showCacheHitMessage: boolean
  readonly showSuccessMessage: boolean
  readonly onPipelineProgress?: (stage: SceneGenerationPipelineStage, current: number, total: number) => void
  readonly onSaving?: () => void
  readonly shouldCancel?: () => boolean
  readonly suppressLoggerPanel?: boolean
  readonly enableTraitsUpdate?: boolean
  readonly onTraitsUpdateComplete?: (summary: TraitsUpdateSummary) => void
}

export async function generateDraftForWorkspaceSceneWorkflow(
  sceneUri: vscode.Uri,
  options: GenerateDraftWorkflowOptions
): Promise<GenerateDraftWorkflowResult> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(sceneUri)

  if (!workspaceFolder) {
    return { ok: false, kind: "failed", message: "씬 파일이 속한 워크스페이스 폴더를 찾을 수 없습니다." }
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    return {
      ok: false,
      kind: "failed",
      message: "Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요."
    }
  }

  if (!isDirectSceneTextFile(sceneUri, workspaceFolder)) {
    return {
      ok: false,
      kind: "failed",
      message:
        "Storyboard 씬 파일만 처리할 수 있습니다. `scene/NN-slug.txt` 형식의 파일을 선택하거나 해당 파일을 편집기에서 연 뒤 다시 시도해 주세요."
    }
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri)
  const fileName = sceneUri.path.split("/").pop() ?? ""

  if (!parseSceneFileName(fileName)) {
    return { ok: false, kind: "failed", message: "씬 파일명은 `NN-slug.txt` 형식이어야 합니다." }
  }

  let scene

  try {
    scene = await readSceneFile(sceneUri, vscodeFsAdapter, fileName)
  } catch (error) {
    if (error instanceof SceneParseError) {
      return { ok: false, kind: "failed", message: `씬 파일을 읽을 수 없습니다: ${error.message}` }
    }

    options.logger.error("Failed to read scene file", error)

    if (!options.suppressLoggerPanel) {
      options.logger.show()
    }

    return {
      ok: false,
      kind: "failed",
      message: "씬 파일을 읽는 중 오류가 발생했습니다. Output 패널을 확인해 주세요."
    }
  }

  let project

  try {
    project = await readProjectJson(paths.projectJson)
  } catch (error) {
    options.logger.error("Failed to read project.json", error)

    if (!options.suppressLoggerPanel) {
      options.logger.show()
    }

    return {
      ok: false,
      kind: "failed",
      message: "project.json을 읽을 수 없습니다. Output 패널을 확인해 주세요."
    }
  }

  const ctxPaths = sceneContextPaths(paths)
  let context

  try {
    context = await buildSceneContext(ctxPaths, scene, sceneContextFileSystem)
  } catch (error) {
    options.logger.error("Failed to build scene context", error)

    if (!options.suppressLoggerPanel) {
      options.logger.show()
    }

    return {
      ok: false,
      kind: "failed",
      message: "씬 컨텍스트를 구성하지 못했습니다. Output 패널을 확인해 주세요."
    }
  }

  const previousContext = await readPreviousSceneContext(ctxPaths, scene.order, sceneContextFileSystem)
  const inputHash = computeSceneInputHash({
    sceneBody: context.scene.body,
    characters: context.characters,
    background: context.background,
    format: project.format
  })

  const draftUri = draftPath(workspaceFolder.uri, scene.stem)
  const cacheUri = sceneCacheFilePath(paths, scene.stem)

  if (!options.force && (await isCacheHit(cacheUri, draftUri, inputHash))) {
    if (options.showCacheHitMessage) {
      await vscode.window.showInformationMessage("입력이 동일하여 캐시된 초안을 엽니다.")
    }

    if (options.openDocumentOnSuccess) {
      const doc = await vscode.workspace.openTextDocument(draftUri)
      await vscode.window.showTextDocument(doc)
    }

    return { ok: true, kind: "cache_hit" }
  }

  const aiService = new StoryboardAIService(options.aiProviderRegistry)
  const pipelineProviders = {
    situationExtraction: options.aiProviderRegistry.getTaskProvider("situationExtraction"),
    personaDialogue: options.aiProviderRegistry.getTaskProvider("personaDialogue"),
    sceneDraft: options.aiProviderRegistry.getTaskProvider("sceneDraft")
  }
  const cacheProviders = {
    ...pipelineProviders,
    traitsExtraction: options.aiProviderRegistry.getTaskProvider("traitsExtraction")
  } satisfies Partial<Record<AiTaskName, AiProviderId>>

  try {
    const result = await runSceneGenerationPipeline({
      context,
      aiService,
      format: project.format,
      previousContext,
      providers: pipelineProviders,
      onProgress: (stage, current, total) => {
        if (options.shouldCancel?.()) {
          return
        }

        options.onPipelineProgress?.(stage, current, total)
      },
      shouldCancel: options.shouldCancel
    })

    options.onSaving?.()

    const draft = createDraft({
      sceneStem: scene.stem,
      format: project.format,
      body: result.draftBody
    })

    await ensureSceneCacheDirectory(paths)

    const cacheRecord: SceneCacheRecord = {
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
      providers: cacheProviders
    }

    await writeDraftFile(draftUri, vscodeFsAdapter, draft)
    await writeSceneCacheFile(cacheUri, vscodeFsAdapter, cacheRecord)

    if (options.enableTraitsUpdate !== false) {
      const detectedCharacterCards = context.characters.filter((card) =>
        result.detectedCharacters.includes(card.name)
      )

      scheduleCharacterTraitsUpdate({
        queueKey: workspaceFolder.uri.toString(),
        draftBody: result.draftBody,
        detectedCharacterCards,
        aiService,
        fileSystem: vscodeFsAdapter,
        resolveCharacterCardUri: (card) => characterCardPath(workspaceFolder.uri, card.id),
        logger: options.logger,
        onComplete: options.onTraitsUpdateComplete
      })
    }

    if (options.openDocumentOnSuccess) {
      const doc = await vscode.workspace.openTextDocument(draftUri)
      await vscode.window.showTextDocument(doc)
    }

    if (options.showSuccessMessage) {
      await vscode.window.showInformationMessage(
        options.force ? "초안을 다시 생성해 저장했습니다." : "초안을 생성해 저장했습니다."
      )
    }

    return { ok: true, kind: "generated" }
  } catch (error) {
    if (error instanceof SceneGenerationPipelineCancelledError) {
      return { ok: false, kind: "cancelled" }
    }

    options.logger.error("Draft generation failed", error)

    if (!options.suppressLoggerPanel) {
      options.logger.show()
    }

    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, kind: "failed", message: `초안 생성에 실패했습니다: ${message}` }
  }
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
        logger: options.logger,
        openDocumentOnSuccess: true,
        showCacheHitMessage: true,
        showSuccessMessage: true,
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
        return
      }

      if (result.kind === "cancelled") {
        return
      }

      await vscode.window.showErrorMessage(result.message)
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
    logger: dependencies.logger
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
