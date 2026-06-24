import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { draftPath, getStoryboardProjectPaths, isDirectSceneTextFile } from "../core/pathConventions"
import { vscodeFsAdapter } from "../core/vscodeFileSystem"
import { hasStoryboardProject } from "../core/workspace"
import { createDraft, parseDraft, readDraftFile, writeDraftFile } from "../files/draft"
import { readProjectJson } from "../files/projectJson"
import { parseSceneFileName } from "../shared/scene"
import { StoryboardAIService } from "../services/ai/AIService"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import { recordUsageSafely } from "../services/ai/recordUsageSafely"
import type { UsageRecorder } from "../services/ai/UsageRecorder"

const applyDraftFormatCommand = "storyboard.draft.applyFormat"

function resolveSceneUri(invokedUri?: vscode.Uri): vscode.Uri | undefined {
  if (invokedUri && invokedUri.scheme === "file") {
    return invokedUri
  }

  const doc = vscode.window.activeTextEditor?.document

  if (!doc || doc.uri.scheme !== "file") {
    return undefined
  }

  return doc.uri
}

export interface RegisterApplyDraftFormatCommandDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly logger: StoryboardLogger
  readonly usageRecorder: UsageRecorder
}

export async function runApplyDraftFormatForScene(
  sceneUri: vscode.Uri,
  dependencies: RegisterApplyDraftFormatCommandDependencies
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
      "Storyboard 씬 파일만 처리할 수 있습니다. `scene/NN-slug.txt` 형식의 파일을 사용해 주세요."
    )
    return
  }

  const fileName = sceneUri.path.split("/").pop() ?? ""
  const nameParts = parseSceneFileName(fileName)

  if (!nameParts) {
    await vscode.window.showErrorMessage("씬 파일명은 `NN-slug.txt` 형식이어야 합니다.")
    return
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri)
  const draftUri = draftPath(workspaceFolder.uri, nameParts.stem)

  let project

  try {
    project = await readProjectJson(paths.projectJson)
  } catch (error) {
    dependencies.logger.error("Failed to read project.json", error)
    await vscode.window.showErrorMessage("project.json을 읽을 수 없습니다. Output 패널을 확인해 주세요.")
    dependencies.logger.show()
    return
  }

  let rawDraft: string

  try {
    rawDraft = await readDraftFile(draftUri, vscodeFsAdapter)
  } catch {
    await vscode.window.showErrorMessage("해당 씬의 초안 파일을 찾을 수 없습니다. 먼저 초안을 생성해 주세요.")
    return
  }

  let existing

  try {
    existing = parseDraft(rawDraft)
  } catch (error) {
    dependencies.logger.error("Failed to parse draft", error)
    await vscode.window.showErrorMessage("초안 파일 형식이 올바르지 않습니다. Output 패널을 확인해 주세요.")
    dependencies.logger.show()
    return
  }

  const aiService = new StoryboardAIService(dependencies.aiProviderRegistry, {
    onUsage: (record): void => {
      recordUsageSafely(dependencies.usageRecorder, workspaceFolder.uri, record, dependencies.logger)
    }
  })

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Storyboard 장르 포맷 적용",
        cancellable: true
      },
      (progress, token) =>
        applyDraftFormatWithProgress(progress, token, {
          aiService,
          aiProviderRegistry: dependencies.aiProviderRegistry,
          existing,
          project,
          draftUri,
          sceneStem: nameParts.stem
        })
    )
  } catch (error) {
    dependencies.logger.error("Apply draft format failed", error)
    dependencies.logger.show()
    const message = error instanceof Error ? error.message : String(error)
    await vscode.window.showErrorMessage(`장르 포맷 적용에 실패했습니다: ${message}`)
  }
}

interface ApplyDraftFormatWithProgressOptions {
  readonly aiService: StoryboardAIService
  readonly aiProviderRegistry: AiProviderRegistry
  readonly existing: ReturnType<typeof parseDraft>
  readonly project: Awaited<ReturnType<typeof readProjectJson>>
  readonly draftUri: vscode.Uri
  readonly sceneStem: string
}

async function applyDraftFormatWithProgress(
  progress: vscode.Progress<{ message?: string }>,
  token: vscode.CancellationToken,
  options: ApplyDraftFormatWithProgressOptions
): Promise<void> {
  const { aiService, aiProviderRegistry, existing, project, draftUri, sceneStem } = options

  progress.report({ message: "장르 포맷 적용 중…" })

  if (token.isCancellationRequested) {
    return
  }

  const formattedBody = await aiService.applyGenreFormat(existing.body, project.format, {
    providerId: aiProviderRegistry.getTaskProvider("sceneDraft"),
    attribution: { primary: { kind: "scene", id: sceneStem } }
  })

  if (token.isCancellationRequested) {
    return
  }

  const draft = createDraft({
    sceneStem: existing.sceneStem,
    format: project.format,
    body: formattedBody,
    generatedAt: existing.generatedAt
  })

  progress.report({ message: "저장 중…" })
  await writeDraftFile(draftUri, vscodeFsAdapter, draft)

  const doc = await vscode.workspace.openTextDocument(draftUri)
  await vscode.window.showTextDocument(doc)
  progress.report({ message: "완료" })
  void vscode.window.showInformationMessage("장르 포맷을 적용해 초안을 저장했습니다.")
}

async function runCommand(
  invokedUri: vscode.Uri | undefined,
  dependencies: RegisterApplyDraftFormatCommandDependencies
): Promise<void> {
  const sceneUri = resolveSceneUri(invokedUri)

  if (!sceneUri) {
    await vscode.window.showErrorMessage(
      "씬 파일 URI가 없습니다. `scene` 폴더의 `.txt` 파일을 열거나 탐색기에서 명령을 실행해 주세요."
    )
    return
  }

  await runApplyDraftFormatForScene(sceneUri, dependencies)
}

export function registerApplyDraftFormatCommand(
  dependencies: RegisterApplyDraftFormatCommandDependencies
): vscode.Disposable {
  return vscode.commands.registerCommand(applyDraftFormatCommand, (uri?: vscode.Uri) =>
    runCommand(uri, dependencies)
  )
}
