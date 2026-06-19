import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { draftPath, getStoryboardProjectPaths, type StoryboardProjectPaths } from "../core/pathConventions"
import {
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
  type SceneContextWorkspaceFileSystem,
  type SceneContextWorkspacePaths
} from "../core/sceneContext"
import { hasStoryboardProject, uriExists } from "../core/workspace"
import { createDraft, parseDraft, readDraftFile, writeDraftFile, type DraftFileSystem } from "../files/draft"
import { readSceneFile } from "../files/scene"
import { StoryboardAIService } from "../services/ai/AIService"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import { recordUsageSafely } from "../services/ai/recordUsageSafely"
import type { ConfigBridge } from "../services/settings/ConfigBridge"
import type { UsageRecorder } from "../services/ai/UsageRecorder"
import { buildRevisionInstructions, countBlockingIssues } from "../shared/draftReview"
import { parseSceneStem } from "../shared/scene"

const reviseDraftCommand = "storyboard.draft.reviseLoop"
const defaultMaxIterations = 2
const minMaxIterations = 1
const maxMaxIterations = 5

const vscodeFsAdapter: DraftFileSystem = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

const sceneContextFileSystem: SceneContextWorkspaceFileSystem = {
  readFile: vscodeFsAdapter.readFile,
  writeFile: vscodeFsAdapter.writeFile,
  readDirectory: async (uri: unknown): Promise<[string, { type: "file" | "directory" }][]> => {
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
    bibleCanon: paths.bibleCanon,
    joinPath: (base: unknown, ...segments: string[]): vscode.Uri =>
      vscode.Uri.joinPath(base as vscode.Uri, ...segments)
  }
}

export interface RegisterReviseDraftCommandDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly configBridge: ConfigBridge
  readonly logger: StoryboardLogger
  readonly usageRecorder: UsageRecorder
}

export function registerReviseDraftCommand(
  dependencies: RegisterReviseDraftCommandDependencies
): vscode.Disposable {
  return vscode.commands.registerCommand(reviseDraftCommand, (uri?: vscode.Uri) =>
    runReviseDraft(uri, dependencies)
  )
}

function resolveSceneStem(uri: vscode.Uri): string | undefined {
  const fileName = uri.path.split("/").pop() ?? ""
  const stem = fileName.replace(/\.(md|txt)$/, "")
  return parseSceneStem(stem) ? stem : undefined
}

function resolveMaxIterations(): number {
  const configured = vscode.workspace
    .getConfiguration("storyboard")
    .get<number>("draft.reviseMaxIterations", defaultMaxIterations)
  const value = Math.floor(Number.isFinite(configured) ? configured : defaultMaxIterations)
  return Math.min(maxMaxIterations, Math.max(minMaxIterations, value))
}

async function runReviseDraft(
  invokedUri: vscode.Uri | undefined,
  dependencies: RegisterReviseDraftCommandDependencies
): Promise<void> {
  const targetUri = invokedUri ?? vscode.window.activeTextEditor?.document.uri

  if (!targetUri || targetUri.scheme !== "file") {
    await vscode.window.showErrorMessage("씬 또는 초안 파일을 연 뒤 다시 시도해 주세요.")
    return
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri)

  if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showWarningMessage("Storyboard 프로젝트가 아닙니다.")
    return
  }

  const sceneStem = resolveSceneStem(targetUri)

  if (!sceneStem) {
    await vscode.window.showErrorMessage("씬/초안 파일명은 `NN-slug` 형식이어야 합니다.")
    return
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri)
  const draftUri = draftPath(workspaceFolder.uri, sceneStem)

  if (!(await uriExists(draftUri))) {
    await vscode.window.showInformationMessage("초안이 없습니다. 먼저 Generate Draft를 실행해 주세요.")
    return
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Storyboard 초안 검수·재작성",
      cancellable: true
    },
    async (progress, token) => {
      try {
        await reviseDraftLoop({
          dependencies,
          workspaceFolder,
          paths,
          draftUri,
          sceneStem,
          maxIterations: resolveMaxIterations(),
          progress,
          token
        })
      } catch (error) {
        dependencies.logger.error("Draft revise loop failed", error)
        dependencies.logger.show()
        const message = error instanceof Error ? error.message : String(error)
        await vscode.window.showErrorMessage(`초안 검수·재작성에 실패했습니다: ${message}`)
      }
    }
  )
}

interface ReviseDraftLoopOptions {
  readonly dependencies: RegisterReviseDraftCommandDependencies
  readonly workspaceFolder: vscode.WorkspaceFolder
  readonly paths: StoryboardProjectPaths
  readonly draftUri: vscode.Uri
  readonly sceneStem: string
  readonly maxIterations: number
  readonly progress: vscode.Progress<{ message?: string }>
  readonly token: vscode.CancellationToken
}

async function reviseDraftLoop(options: ReviseDraftLoopOptions): Promise<void> {
  const { dependencies, workspaceFolder, paths, draftUri, sceneStem, maxIterations, progress, token } = options

  const aiService = new StoryboardAIService(dependencies.aiProviderRegistry, {
    onUsage: (record): void => {
      recordUsageSafely(dependencies.usageRecorder, workspaceFolder.uri, record, dependencies.logger)
    }
  })
  const attribution = { primary: { kind: "scene" as const, id: sceneStem } }
  const registry = dependencies.aiProviderRegistry

  const sceneFileName = `${sceneStem}.txt`
  const scene = await readSceneFile(
    vscode.Uri.joinPath(paths.sceneDirectory, sceneFileName),
    vscodeFsAdapter,
    sceneFileName
  )
  const ctxPaths = sceneContextPaths(paths)
  const context = await buildSceneContext(ctxPaths, scene, sceneContextFileSystem)
  const narrative = await buildNarrativeContext(ctxPaths, context, sceneContextFileSystem)
  const factLines = formatBibleFactLines(context, narrative.bibleFacts)
  const characterNames = context.characters.map((character) => character.name)
  const intent = scene.body

  const draft = parseDraft(await readDraftFile(draftUri, vscodeFsAdapter))
  let body = draft.body
  let revisionCount = 0
  let blocking = 0
  let passed = false

  while (!token.isCancellationRequested) {
    progress.report({ message: `검사 중 (${revisionCount + 1}/${maxIterations + 1})…` })

    const [continuityIssues, critiqueIssues] = await Promise.all([
      aiService.checkContinuity(body, factLines, {
        providerId: registry.getTaskProvider("continuityCheck"),
        attribution
      }),
      aiService.critiqueDraft(
        { body, intent, characters: characterNames, facts: factLines },
        { providerId: registry.getTaskProvider("draftCritique"), attribution }
      )
    ])

    blocking = countBlockingIssues(continuityIssues, critiqueIssues)

    if (blocking === 0) {
      passed = true
      break
    }

    if (revisionCount >= maxIterations || token.isCancellationRequested) {
      break
    }

    progress.report({ message: `재작성 중 (${revisionCount + 1}/${maxIterations})…` })

    body = await aiService.reviseDraft(
      {
        body,
        format: draft.format,
        instructions: buildRevisionInstructions(continuityIssues, critiqueIssues),
        intent,
        facts: factLines
      },
      { providerId: registry.getTaskProvider("draftRevision"), attribution }
    )

    await writeDraftFile(draftUri, vscodeFsAdapter, createDraft({ sceneStem, format: draft.format, body }))
    revisionCount += 1
  }

  const document = await vscode.workspace.openTextDocument(draftUri)
  await vscode.window.showTextDocument(document)

  await reportResult({ passed, revisionCount, blocking, cancelled: token.isCancellationRequested })
}

async function reportResult(result: {
  readonly passed: boolean
  readonly revisionCount: number
  readonly blocking: number
  readonly cancelled: boolean
}): Promise<void> {
  if (result.cancelled && !result.passed) {
    await vscode.window.showWarningMessage(
      `검수·재작성을 취소했습니다. (재작성 ${result.revisionCount}회)`
    )
    return
  }

  if (result.passed) {
    await vscode.window.showInformationMessage(
      result.revisionCount === 0
        ? "검수를 통과했습니다. 수정할 항목이 없습니다."
        : `검수를 통과했습니다. 초안을 ${result.revisionCount}회 재작성했습니다.`
    )
    return
  }

  await vscode.window.showWarningMessage(
    `재작성 ${result.revisionCount}회 후에도 차단 이슈 ${result.blocking}개가 남았습니다. 초안을 직접 검토해 주세요.`
  )
}
