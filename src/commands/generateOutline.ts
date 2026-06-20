import * as vscode from "vscode"

import { validateGenerationContract } from "../core/generationContract"
import { listCharacterBriefs } from "../core/characterBriefs"
import type { StoryboardLogger } from "../core/logger"
import { getStoryboardProjectPaths } from "../core/pathConventions"
import { resolveStoryboardWorkspaceRoot, uriExists } from "../core/workspace"
import { type CardFileSystem } from "../files/card"
import {
  writeChapterPlanFile,
  writeSynopsisFile,
  type OutlineFileSystem
} from "../files/outline"
import { readProjectJson } from "../files/projectJson"
import { StoryboardAIService } from "../services/ai/AIService"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import { recordUsageSafely } from "../services/ai/recordUsageSafely"
import type { UsageRecorder } from "../services/ai/UsageRecorder"
import { toOutlineBrief } from "../shared/outline"
import type { ContractFieldKey } from "../shared/project"

const generateOutlineCommand = "storyboard.outline.generate"

const contractFieldLabels: Record<ContractFieldKey, string> = {
  genre: "장르",
  audience: "독자층",
  pov: "시점",
  targetWordCount: "목표 분량"
}

const outlineFileSystem: OutlineFileSystem = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

const cardFileSystem: CardFileSystem = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

export interface RegisterGenerateOutlineCommandDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly logger: StoryboardLogger
  readonly usageRecorder: UsageRecorder
}

export function registerGenerateOutlineCommand(
  dependencies: RegisterGenerateOutlineCommandDependencies
): vscode.Disposable {
  return vscode.commands.registerCommand(generateOutlineCommand, () => runGenerateOutline(dependencies))
}

async function runGenerateOutline(
  dependencies: RegisterGenerateOutlineCommandDependencies
): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot()

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(
      "Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요."
    )
    return
  }

  const paths = getStoryboardProjectPaths(workspaceRoot)

  let project
  try {
    project = await readProjectJson(paths.projectJson)
  } catch (error) {
    dependencies.logger.error("Failed to read project.json", error)
    dependencies.logger.show()
    await vscode.window.showErrorMessage("project.json을 읽을 수 없습니다. Output 패널을 확인해 주세요.")
    return
  }

  const readiness = validateGenerationContract(project.setting)

  if (readiness.missing.length > 0) {
    const openSettings = "설정 열기"
    const missingLabels = readiness.missing.map((key) => contractFieldLabels[key]).join(", ")
    const choice = await vscode.window.showWarningMessage(
      `생성 계약에 필요한 항목이 비어 있습니다: ${missingLabels}. 설정에서 채운 뒤 다시 시도해 주세요.`,
      openSettings
    )

    if (choice === openSettings) {
      await vscode.commands.executeCommand("storyboard.settings.open")
    }

    return
  }

  if (await outlineFilesExist(paths.outlineSynopsis, paths.outlineChapters)) {
    const overwrite = "덮어쓰기"
    const choice = await vscode.window.showWarningMessage(
      "이미 아웃라인 파일이 있습니다. 덮어쓸까요?",
      { modal: true },
      overwrite
    )

    if (choice !== overwrite) {
      return
    }
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Storyboard 아웃라인 생성",
      cancellable: false
    },
    async (progress) => {
      const aiService = new StoryboardAIService(dependencies.aiProviderRegistry, {
        onUsage: (record): void => {
          recordUsageSafely(dependencies.usageRecorder, workspaceRoot, record, dependencies.logger)
        }
      })
      const brief = toOutlineBrief(project)

      try {
        progress.report({ message: "시놉시스 생성 중…" })
        const synopsis = await aiService.generateOutlineSynopsis(brief)

        const characters = await listCharacterBriefs(paths.characterDirectory, cardFileSystem)

        progress.report({ message: "챕터 구성 중…" })
        const chapterPlan = await aiService.generateChapterPlan(brief, synopsis, characters)

        progress.report({ message: "파일 저장 중…" })
        await vscode.workspace.fs.createDirectory(paths.outlineDirectory)
        await writeSynopsisFile(paths.outlineSynopsis, outlineFileSystem, synopsis)
        await writeChapterPlanFile(paths.outlineChapters, outlineFileSystem, chapterPlan)

        const doc = await vscode.workspace.openTextDocument(paths.outlineSynopsis)
        await vscode.window.showTextDocument(doc)
        await vscode.window.showInformationMessage(
          "아웃라인을 생성했습니다 (synopsis.md, chapters.yaml)."
        )
      } catch (error) {
        dependencies.logger.error("Outline generation failed", error)
        dependencies.logger.show()
        const message = error instanceof Error ? error.message : String(error)
        await vscode.window.showErrorMessage(`아웃라인 생성에 실패했습니다: ${message}`)
      }
    }
  )
}

async function outlineFilesExist(synopsisUri: vscode.Uri, chaptersUri: vscode.Uri): Promise<boolean> {
  return (await uriExists(synopsisUri)) || (await uriExists(chaptersUri))
}
