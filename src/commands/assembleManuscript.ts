import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import { assembleManuscript, type ManuscriptDraftEntry } from "../core/manuscriptAssembly"
import { getStoryboardProjectPaths, type StoryboardProjectPaths } from "../core/pathConventions"
import { resolveStoryboardWorkspaceRoot, uriExists } from "../core/workspace"
import { parseDraft, readDraftFile, type DraftFileSystem } from "../files/draft"
import { readChapterPlanFile, type OutlineFileSystem } from "../files/outline"
import { readProjectJson } from "../files/projectJson"
import { parseSceneStem } from "../shared/scene"

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
    const draftsByOrder = await collectDraftsByOrder(paths, dependencies.logger)

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

async function collectDraftsByOrder(
  paths: StoryboardProjectPaths,
  logger: StoryboardLogger
): Promise<Map<number, ManuscriptDraftEntry>> {
  const draftsByOrder = new Map<number, ManuscriptDraftEntry>()

  let entries: [string, vscode.FileType][]
  try {
    entries = await vscode.workspace.fs.readDirectory(paths.draftDirectory)
  } catch {
    return draftsByOrder
  }

  for (const [name, fileType] of entries) {
    if (fileType !== vscode.FileType.File || !name.endsWith(".md")) {
      continue
    }

    const stem = name.slice(0, -".md".length)
    const parts = parseSceneStem(stem)
    if (!parts) {
      continue
    }

    const draftUri = vscode.Uri.joinPath(paths.draftDirectory, name)
    try {
      const draft = parseDraft(await readDraftFile(draftUri, fileSystem))
      draftsByOrder.set(parts.order, { stem, body: draft.body })
    } catch (error) {
      logger.warn(`Skipping unreadable draft: ${name} (${error instanceof Error ? error.message : String(error)})`)
    }
  }

  return draftsByOrder
}
