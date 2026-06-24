import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { getStoryboardProjectPaths, isHiddenSceneFileName } from "../core/pathConventions"
import { hasStoryboardProject } from "../core/workspace"
import { parseSceneFileName } from "../shared/scene"
import type { UsageRecorder } from "../services/ai/UsageRecorder"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import type { SceneGenerationPipelineStage } from "../services/ai/pipelines/sceneGenerationPipeline"
import type { ConfigBridge } from "../services/settings/ConfigBridge"
import {
  generateDraftForWorkspaceSceneWorkflow,
  stageProgressLabel
} from "./generateDraft"
import { maybeRunReviseAfterGenerate } from "./reviseDraft"

const generateAllDraftsCommand = "storyboard.draft.generateAll"

export interface RegisterGenerateAllDraftsCommandDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly configBridge: ConfigBridge
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

interface GenerateAllDraftsSummary {
  generated: number
  cacheHits: number
  failures: number
  readonly failureLabels: string[]
}

async function generateAllDraftsWithProgress(
  scenes: readonly vscode.Uri[],
  dependencies: RegisterGenerateAllDraftsCommandDependencies,
  progress: vscode.Progress<{ message?: string }>,
  token: vscode.CancellationToken,
  summary: GenerateAllDraftsSummary
): Promise<void> {
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
      configBridge: dependencies.configBridge,
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
        summary.cacheHits += 1
      } else {
        summary.generated += 1

        await maybeRunReviseAfterGenerate(
          sceneUri,
          dependencies.configBridge,
          {
            aiProviderRegistry: dependencies.aiProviderRegistry,
            usageRecorder: dependencies.usageRecorder,
            logger: dependencies.logger
          },
          {
            onWillRun: () => progress.report({ message: `[${index + 1}/${total}] ${label} — 검수·재작성 중…` }),
            shouldCancel: () => token.isCancellationRequested
          }
        )
      }

      continue
    }

    if (result.kind === "cancelled") {
      break
    }

    summary.failures += 1

    if (summary.failureLabels.length < 5) {
      summary.failureLabels.push(`${label}: ${result.message}`)
    }

    dependencies.logger.error(`Draft generation failed for ${label}`, new Error(result.message))
  }
}

async function reportGenerateAllDraftsSummary(
  sceneCount: number,
  summary: GenerateAllDraftsSummary,
  logger: StoryboardLogger
): Promise<void> {
  const parts: string[] = [`총 ${sceneCount}개 씬 중 생성 ${summary.generated}건, 캐시 재사용 ${summary.cacheHits}건`]

  if (summary.failures > 0) {
    parts.push(`실패 ${summary.failures}건`)
  }

  const text = parts.join(" · ")

  if (summary.failures > 0) {
    const detail =
      summary.failureLabels.length > 0 ? `${text}\n\n${summary.failureLabels.join("\n")}` : text
    await vscode.window.showWarningMessage(detail, { modal: false })
    logger.show()
    return
  }

  await vscode.window.showInformationMessage(text)
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

  const summary: GenerateAllDraftsSummary = { generated: 0, cacheHits: 0, failures: 0, failureLabels: [] }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Storyboard 전체 초안 생성",
      cancellable: true
    },
    (progress, token) => generateAllDraftsWithProgress(scenes, dependencies, progress, token, summary)
  )

  await reportGenerateAllDraftsSummary(scenes.length, summary, dependencies.logger)
}

export function registerGenerateAllDraftsCommand(
  dependencies: RegisterGenerateAllDraftsCommandDependencies
): vscode.Disposable {
  return vscode.commands.registerCommand(generateAllDraftsCommand, () => runGenerateAllDrafts(dependencies))
}
