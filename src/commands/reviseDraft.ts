import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { draftPath, getStoryboardProjectPaths } from "../core/pathConventions"
import { runReviseDraftWorkflow } from "../core/reviseDraftWorkflow"
import { recordRevisionEntry } from "../core/revisionPlanRecorder"
import { hasStoryboardProject, uriExists } from "../core/workspace"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import type { ConfigBridge } from "../services/settings/ConfigBridge"
import type { UsageRecorder } from "../services/ai/UsageRecorder"
import { parseSceneStem } from "../shared/scene"

const reviseDraftCommand = "storyboard.draft.reviseLoop"
const defaultMaxIterations = 2
const minMaxIterations = 1
const maxMaxIterations = 5

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
        const result = await runReviseDraftWorkflow({
          aiProviderRegistry: dependencies.aiProviderRegistry,
          usageRecorder: dependencies.usageRecorder,
          logger: dependencies.logger,
          workspaceUri: workspaceFolder.uri,
          paths,
          draftUri,
          sceneStem,
          maxIterations: resolveMaxIterations(),
          onProgress: (message) => progress.report({ message }),
          shouldCancel: () => token.isCancellationRequested
        })

        try {
          await recordRevisionEntry(paths, {
            sceneStem,
            checkedAt: new Date().toISOString(),
            revisionCount: result.revisionCount,
            remainingBlocking: result.remainingBlocking,
            instructions: result.instructions
          })
        } catch (error) {
          dependencies.logger.warn(
            `revision-plan.yaml 기록에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`
          )
        }

        const document = await vscode.workspace.openTextDocument(draftUri)
        await vscode.window.showTextDocument(document)
        await reportResult(result)
      } catch (error) {
        dependencies.logger.error("Draft revise loop failed", error)
        dependencies.logger.show()
        const message = error instanceof Error ? error.message : String(error)
        await vscode.window.showErrorMessage(`초안 검수·재작성에 실패했습니다: ${message}`)
      }
    }
  )
}

async function reportResult(result: {
  readonly passed: boolean
  readonly revisionCount: number
  readonly remainingBlocking: number
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
    `재작성 ${result.revisionCount}회 후에도 차단 이슈 ${result.remainingBlocking}개가 남았습니다. 초안을 직접 검토해 주세요.`
  )
}
