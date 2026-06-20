import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { assembleManuscript } from "../core/manuscriptAssembly"
import { collectDraftsByOrder } from "../core/manuscriptDrafts"
import { getStoryboardProjectPaths } from "../core/pathConventions"
import { resolveStoryboardWorkspaceRoot, uriExists } from "../core/workspace"
import { type DraftFileSystem } from "../files/draft"
import { readChapterPlanFile, type OutlineFileSystem } from "../files/outline"
import { readProjectJson } from "../files/projectJson"

const assembleManuscriptCommand = "storyboard.manuscript.assemble"

const fileSystem: DraftFileSystem & OutlineFileSystem = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

export interface RegisterAssembleManuscriptCommandDependencies {
  readonly logger: StoryboardLogger
}

export function registerAssembleManuscriptCommand(
  dependencies: RegisterAssembleManuscriptCommandDependencies
): vscode.Disposable {
  return vscode.commands.registerCommand(assembleManuscriptCommand, () => runAssembleManuscript(dependencies))
}

async function runAssembleManuscript(
  dependencies: RegisterAssembleManuscriptCommandDependencies
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
        "조립할 초안이 없습니다. 먼저 Generate (All) Drafts를 실행해 주세요."
      )
      return
    }

    const manuscript = assembleManuscript({ plan, projectName: project.name, draftsByOrder })

    await vscode.workspace.fs.createDirectory(paths.manuscriptDirectory)

    for (const chapter of manuscript.chapters) {
      const chapterUri = vscode.Uri.joinPath(paths.manuscriptDirectory, chapter.fileName)
      await vscode.workspace.fs.writeFile(chapterUri, new TextEncoder().encode(chapter.markdown))
    }

    await vscode.workspace.fs.writeFile(
      paths.manuscriptVolume,
      new TextEncoder().encode(manuscript.volumeMarkdown)
    )

    const document = await vscode.workspace.openTextDocument(paths.manuscriptVolume)
    await vscode.window.showTextDocument(document)

    await vscode.window.showInformationMessage(
      `원고를 조립했습니다. 챕터 ${manuscript.chapters.length}개, 포함 ${manuscript.includedCount}개, 누락 ${manuscript.missingCount}개, 기타 ${manuscript.extraCount}개.`
    )
  } catch (error) {
    dependencies.logger.error("Manuscript assembly failed", error)
    dependencies.logger.show()
    const message = error instanceof Error ? error.message : String(error)
    await vscode.window.showErrorMessage(`원고 조립에 실패했습니다: ${message}`)
  }
}
