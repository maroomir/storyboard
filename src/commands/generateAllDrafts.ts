import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { getStoryboardProjectPaths, isHiddenSceneFileName } from "../core/pathConventions"
import { hasStoryboardProject } from "../core/workspace"
import { parseSceneFileName } from "../shared/scene"
import type { UsageRecorder } from "../services/ai/UsageRecorder"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import type { SceneGenerationPipelineStage } from "../services/ai/pipelines/sceneGenerationPipeline"
import {
  generateDraftForWorkspaceSceneWorkflow,
  stageProgressLabel
} from "./generateDraft"

const generateAllDraftsCommand = "storyboard.draft.generateAll"

export interface RegisterGenerateAllDraftsCommandDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly logger: StoryboardLogger
  readonly usageRecorder: UsageRecorder
}

async function listSceneUrisOrdered(sceneDirectory: vscode.Uri): Promise<vscode.Uri[]> {
  const entries = await vscode.workspace.fs.readDirectory(sceneDirectory)
  const withParts = entries
    .filter(([name, type]) => type === vscode.FileType.File && name.endsWith(".txt") && !isHiddenSceneFileName(name))
    .map(([name]) => {
      const parts = parseSceneFileName(name)
      return parts ? { name, parts } : undefined
    })
    .filter((item): item is { name: string; parts: NonNullable<ReturnType<typeof parseSceneFileName>> } => Boolean(item))

  withParts.sort((a, b) => {
    if (a.parts.order !== b.parts.order) {
      return a.parts.order - b.parts.order
    }

    return a.name.localeCompare(b.name)
  })

  return withParts.map(({ name }) => vscode.Uri.joinPath(sceneDirectory, name))
}

async function collectStoryboardSceneUris(): Promise<{ scenes: vscode.Uri[]; folderCount: number }> {
  const folders = vscode.workspace.workspaceFolders ?? []
  const scenes: vscode.Uri[] = []
  let folderCount = 0

  for (const folder of folders) {
    if (!(await hasStoryboardProject(folder))) {
      continue
    }

    folderCount += 1
    const paths = getStoryboardProjectPaths(folder.uri)
    scenes.push(...(await listSceneUrisOrdered(paths.sceneDirectory)))
  }

  return { scenes, folderCount }
}

export async function runGenerateAllDrafts(dependencies: RegisterGenerateAllDraftsCommandDependencies): Promise<void> {
  const { scenes, folderCount } = await collectStoryboardSceneUris()

  if (folderCount === 0) {
    await vscode.window.showErrorMessage(
      "Storyboard 프로젝트(.storyboard/project.json)가 있는 워크스페이스 폴더가 없습니다."
    )
    return
  }

  if (scenes.length === 0) {
    await vscode.window.showInformationMessage("처리할 `scene/*.txt` 파일이 없습니다.")
    return
  }

  let generated = 0
  let cacheHits = 0
  let failures = 0
  const failureLabels: string[] = []

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Storyboard 전체 초안 생성",
      cancellable: true
    },
    async (progress, token) => {
      const total = scenes.length

      for (let index = 0; index < scenes.length; index += 1) {
        if (token.isCancellationRequested) {
          break
        }

        const sceneUri = scenes[index]

        if (!sceneUri) {
          continue
        }

        const label = sceneUri.path.split("/").pop() ?? sceneUri.fsPath
        progress.report({ message: `[${index + 1}/${total}] ${label} — 준비 중…` })

        const result = await generateDraftForWorkspaceSceneWorkflow(sceneUri, {
          force: false,
          aiProviderRegistry: dependencies.aiProviderRegistry,
          logger: dependencies.logger,
          usageRecorder: dependencies.usageRecorder,
          suppressLoggerPanel: true,
          openDocumentOnSuccess: false,
          showCacheHitMessage: false,
          showSuccessMessage: false,
          onPipelineProgress: (stage: SceneGenerationPipelineStage, current: number, stageTotal: number) => {
            if (token.isCancellationRequested) {
              return
            }

            const stageLabel = stageProgressLabel(stage)
            const stageSuffix =
              stageTotal > 1 ? `${stageLabel} (${current}/${stageTotal})` : stageLabel
            progress.report({ message: `[${index + 1}/${total}] ${label} — ${stageSuffix}…` })
          },
          onSaving: () => {
            if (!token.isCancellationRequested) {
              progress.report({ message: `[${index + 1}/${total}] ${label} — 저장 중…` })
            }
          },
          shouldCancel: () => token.isCancellationRequested
        })

        if (result.ok) {
          if (result.kind === "cache_hit") {
            cacheHits += 1
          } else {
            generated += 1
          }

          continue
        }

        if (result.kind === "cancelled") {
          break
        }

        failures += 1

        if (failureLabels.length < 5) {
          failureLabels.push(`${label}: ${result.message}`)
        }

        dependencies.logger.error(`Draft generation failed for ${label}`, new Error(result.message))
      }
    }
  )

  const parts: string[] = [`총 ${scenes.length}개 씬 중 생성 ${generated}건, 캐시 재사용 ${cacheHits}건`]

  if (failures > 0) {
    parts.push(`실패 ${failures}건`)
  }

  const summary = parts.join(" · ")

  if (failures > 0) {
    const detail =
      failureLabels.length > 0 ? `${summary}\n\n${failureLabels.join("\n")}` : summary
    await vscode.window.showWarningMessage(detail, { modal: false })
    dependencies.logger.show()
    return
  }

  await vscode.window.showInformationMessage(summary)
}

export function registerGenerateAllDraftsCommand(
  dependencies: RegisterGenerateAllDraftsCommandDependencies
): vscode.Disposable {
  return vscode.commands.registerCommand(generateAllDraftsCommand, () => runGenerateAllDrafts(dependencies))
}
