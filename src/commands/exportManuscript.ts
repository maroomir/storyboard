import * as vscode from "vscode"

import type { StoryboardLogger } from "../core/logger"
import {
  renderManuscriptExport,
  type ManuscriptExportFormat
} from "../core/manuscriptExport"
import { getStoryboardProjectPaths } from "../core/pathConventions"
import { resolveStoryboardWorkspaceRoot, uriExists } from "../core/workspace"
import { readProjectJson } from "../files/projectJson"

const exportManuscriptCommand = "storyboard.draft.export"

interface ExportFormatItem extends vscode.QuickPickItem {
  readonly format: ManuscriptExportFormat
  readonly extension: string
}

const exportFormatItems: ExportFormatItem[] = [
  { label: "Markdown (.md)", format: "md", extension: "md" },
  { label: "Plain text (.txt)", format: "txt", extension: "txt" }
]

export interface RegisterExportManuscriptCommandDependencies {
  readonly logger: StoryboardLogger
}

export function registerExportManuscriptCommand(
  dependencies: RegisterExportManuscriptCommandDependencies
): vscode.Disposable {
  return vscode.commands.registerCommand(exportManuscriptCommand, () => runExportManuscript(dependencies))
}

async function runExportManuscript(
  dependencies: RegisterExportManuscriptCommandDependencies
): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot()

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(
      "Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요."
    )
    return
  }

  const paths = getStoryboardProjectPaths(workspaceRoot)

  if (!(await uriExists(paths.manuscriptVolume))) {
    await vscode.window.showInformationMessage(
      "내보낼 원고가 없습니다. 먼저 Assemble Manuscript를 실행해 주세요."
    )
    return
  }

  const picked = await vscode.window.showQuickPick(exportFormatItems, {
    placeHolder: "내보낼 형식을 선택하세요."
  })
  if (!picked) {
    return
  }

  try {
    const project = await readProjectJson(paths.projectJson)
    const markdown = new TextDecoder().decode(await vscode.workspace.fs.readFile(paths.manuscriptVolume))
    const content = renderManuscriptExport(markdown, picked.format)

    const targetUri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(workspaceRoot, `${project.name}.${picked.extension}`),
      filters: { [picked.label]: [picked.extension] }
    })
    if (!targetUri) {
      return
    }

    await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(content))

    const document = await vscode.workspace.openTextDocument(targetUri)
    await vscode.window.showTextDocument(document)
    await vscode.window.showInformationMessage(`원고를 내보냈습니다: ${targetUri.fsPath}`)
  } catch (error) {
    dependencies.logger.error("Manuscript export failed", error)
    dependencies.logger.show()
    const message = error instanceof Error ? error.message : String(error)
    await vscode.window.showErrorMessage(`원고 내보내기에 실패했습니다: ${message}`)
  }
}
