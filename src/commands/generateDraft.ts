import * as vscode from "vscode"

import {
  buildSceneContext,
  readPreviousSceneContext,
  type SceneContextWorkspaceFileSystem,
  type SceneContextWorkspacePaths
} from "../core/sceneContext"
import type { StoryboardLogger } from "../core/logger"
import { draftPath, getStoryboardProjectPaths, type StoryboardProjectPaths } from "../core/pathConventions"
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

function stageProgressLabel(stage: SceneGenerationPipelineStage): string {
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

export async function runGenerateDraftForWorkspaceScene(
  sceneUri: vscode.Uri,
  options: RunGenerateDraftForWorkspaceSceneOptions
): Promise<void> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(sceneUri)

  if (!workspaceFolder) {
    await vscode.window.showErrorMessage("씬 파일이 속한 워크스페이스 폴더를 찾을 수 없습니다.")
    return
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showErrorMessage("Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.")
    return
  }

  if (!isDirectSceneTextFile(sceneUri, workspaceFolder)) {
    await vscode.window.showErrorMessage(
      "Storyboard 씬 파일만 처리할 수 있습니다. `scene/NN-slug.txt` 형식의 파일을 선택하거나 해당 파일을 편집기에서 연 뒤 다시 시도해 주세요."
    )
    return
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri)
  const fileName = sceneUri.path.split("/").pop() ?? ""

  if (!parseSceneFileName(fileName)) {
    await vscode.window.showErrorMessage("씬 파일명은 `NN-slug.txt` 형식이어야 합니다.")
    return
  }

  let scene

  try {
    scene = await readSceneFile(sceneUri, vscodeFsAdapter, fileName)
  } catch (error) {
    if (error instanceof SceneParseError) {
      await vscode.window.showErrorMessage(`씬 파일을 읽을 수 없습니다: ${error.message}`)
      return
    }

    options.logger.error("Failed to read scene file", error)
    await vscode.window.showErrorMessage("씬 파일을 읽는 중 오류가 발생했습니다. Output 패널을 확인해 주세요.")
    options.logger.show()
    return
  }

  let project

  try {
    project = await readProjectJson(paths.projectJson)
  } catch (error) {
    options.logger.error("Failed to read project.json", error)
    await vscode.window.showErrorMessage("project.json을 읽을 수 없습니다. Output 패널을 확인해 주세요.")
    options.logger.show()
    return
  }

  const ctxPaths = sceneContextPaths(paths)
  let context

  try {
    context = await buildSceneContext(ctxPaths, scene, sceneContextFileSystem)
  } catch (error) {
    options.logger.error("Failed to build scene context", error)
    await vscode.window.showErrorMessage("씬 컨텍스트를 구성하지 못했습니다. Output 패널을 확인해 주세요.")
    options.logger.show()
    return
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
    await vscode.window.showInformationMessage("입력이 동일하여 캐시된 초안을 엽니다.")
    const doc = await vscode.workspace.openTextDocument(draftUri)
    await vscode.window.showTextDocument(doc)
    return
  }

  const aiService = new StoryboardAIService(options.aiProviderRegistry)

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: options.force ? "Storyboard 초안 다시 생성" : "Storyboard 초안 생성",
        cancellable: true
      },
      async (progress, token) => {
        const result = await runSceneGenerationPipeline({
          context,
          aiService,
          format: project.format,
          previousContext,
          onProgress: (stage, current, total) => {
            if (token.isCancellationRequested) {
              return
            }

            const label = stageProgressLabel(stage)
            progress.report({
              message: total > 1 ? `${label} (${current}/${total})…` : `${label}…`
            })
          },
          shouldCancel: () => token.isCancellationRequested
        })

        progress.report({ message: "파일 저장 중…" })

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
          providers: { ...result.providers } satisfies Partial<Record<AiTaskName, AiProviderId>>
        }

        await writeDraftFile(draftUri, vscodeFsAdapter, draft)
        await writeSceneCacheFile(cacheUri, vscodeFsAdapter, cacheRecord)

        const doc = await vscode.workspace.openTextDocument(draftUri)
        await vscode.window.showTextDocument(doc)
        await vscode.window.showInformationMessage(
          options.force ? "초안을 다시 생성해 저장했습니다." : "초안을 생성해 저장했습니다."
        )
      }
    )
  } catch (error) {
    if (error instanceof SceneGenerationPipelineCancelledError) {
      return
    }

    options.logger.error("Draft generation failed", error)
    options.logger.show()

    const message = error instanceof Error ? error.message : String(error)
    await vscode.window.showErrorMessage(`초안 생성에 실패했습니다: ${message}`)
  }
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
