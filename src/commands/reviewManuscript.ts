import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { assembleManuscript } from "../core/manuscriptAssembly"
import { collectDraftsByOrder } from "../core/manuscriptDrafts"
import { buildManuscriptReviewMarkdown } from "../core/manuscriptReview"
import { getStoryboardProjectPaths } from "../core/pathConventions"
import { resolveStoryboardWorkspaceRoot, uriExists } from "../core/workspace"
import { readBibleFile, type BibleFileSystem } from "../files/bible"
import { type DraftFileSystem } from "../files/draft"
import { readChapterPlanFile, type OutlineFileSystem } from "../files/outline"
import { readProjectJson } from "../files/projectJson"
import { StoryboardAIService } from "../services/ai/AIService"
import type { AiProviderRegistry } from "../services/ai/providerRegistry"
import { flattenChapterPlan, type ChapterPlan } from "../shared/outline"

const reviewManuscriptCommand = "storyboard.manuscript.review"
const reviewFileName = "REVIEW.md"

const fileSystem: DraftFileSystem & OutlineFileSystem & BibleFileSystem = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

export interface RegisterReviewManuscriptCommandDependencies {
  readonly aiProviderRegistry: AiProviderRegistry
  readonly logger: StoryboardLogger
}

export function registerReviewManuscriptCommand(
  dependencies: RegisterReviewManuscriptCommandDependencies
): vscode.Disposable {
  return vscode.commands.registerCommand(reviewManuscriptCommand, () => runReviewManuscript(dependencies))
}

async function runReviewManuscript(
  dependencies: RegisterReviewManuscriptCommandDependencies
): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot()

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(
      "Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요."
    )
    return
  }

  const paths = getStoryboardProjectPaths(workspaceRoot)

  if (!(await uriExists(paths.outlineChapters))) {
    await vscode.window.showWarningMessage(
      "아웃라인(chapters.yaml)이 없습니다. 먼저 Generate Novel Outline을 실행해 주세요."
    )
    return
  }

  try {
    const project = await readProjectJson(paths.projectJson)
    const plan = await readChapterPlanFile(paths.outlineChapters, fileSystem)
    const draftsByOrder = await collectDraftsByOrder(paths, fileSystem, dependencies.logger)

    if (draftsByOrder.size === 0) {
      await vscode.window.showInformationMessage(
        "검사할 초안이 없습니다. 먼저 Generate (All) Drafts를 실행해 주세요."
      )
      return
    }

    const manuscript = assembleManuscript({ plan, projectName: project.name, draftsByOrder })
    const factLines = await loadCanonFactLines(paths.bibleCanon)
    const characters = collectCharacterIds(plan)

    const aiService = new StoryboardAIService(dependencies.aiProviderRegistry)
    const registry = dependencies.aiProviderRegistry

    const { continuityIssues, critiqueIssues } = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Storyboard 원고 최종 검사",
        cancellable: false
      },
      async (progress) => {
        progress.report({ message: "연속성·비평 검사 중…" })

        const [continuity, critique] = await Promise.all([
          aiService.checkContinuity(manuscript.volumeMarkdown, factLines, {
            providerId: registry.getTaskProvider("continuityCheck")
          }),
          aiService.critiqueDraft(
            {
              body: manuscript.volumeMarkdown,
              intent: "전체 원고 최종 검수",
              characters,
              facts: factLines
            },
            { providerId: registry.getTaskProvider("draftCritique") }
          )
        ])

        return { continuityIssues: continuity, critiqueIssues: critique }
      }
    )

    const reportMarkdown = buildManuscriptReviewMarkdown({
      projectName: project.name,
      sceneCount: manuscript.includedCount,
      generatedAt: new Date().toISOString(),
      continuityIssues,
      critiqueIssues
    })

    await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory)
    const reportUri = vscode.Uri.joinPath(paths.manuscriptDirectory, reviewFileName)
    await vscode.workspace.fs.writeFile(reportUri, new TextEncoder().encode(reportMarkdown))

    const document = await vscode.workspace.openTextDocument(reportUri)
    await vscode.window.showTextDocument(document)

    const total = continuityIssues.length + critiqueIssues.length
    await vscode.window.showInformationMessage(
      total === 0
        ? "원고 최종 검사를 마쳤습니다. 발견된 이슈가 없습니다."
        : `원고 최종 검사를 마쳤습니다. 설정 모순 ${continuityIssues.length}건, 비평 ${critiqueIssues.length}건.`
    )
  } catch (error) {
    dependencies.logger.error("Manuscript review failed", error)
    dependencies.logger.show()
    const message = error instanceof Error ? error.message : String(error)
    await vscode.window.showErrorMessage(`원고 최종 검사에 실패했습니다: ${message}`)
  }
}

async function loadCanonFactLines(bibleCanonUri: vscode.Uri): Promise<string[]> {
  if (!(await uriExists(bibleCanonUri))) {
    return []
  }

  const bible = await readBibleFile(bibleCanonUri, fileSystem)
  return bible.facts
    .filter((fact) => fact.status === "canon")
    .map((fact) => `${fact.subject.id} — ${fact.key}: ${fact.value}`)
}

function collectCharacterIds(plan: ChapterPlan): string[] {
  const ids = new Set<string>()

  for (const flatScene of flattenChapterPlan(plan)) {
    for (const id of flatScene.scene.characters) {
      ids.add(id)
    }
  }

  return [...ids]
}
