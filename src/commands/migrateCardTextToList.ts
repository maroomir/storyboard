import * as vscode from "vscode"

import { migrateCardTextFieldsToList } from "../core/cardTextMigration"
import type { StoryboardLogger } from "../core/logger"
import { getStoryboardProjectPaths, isIgnoredSampleCardFileName } from "../core/pathConventions"
import { getTargetWorkspaceFolder, hasStoryboardProject } from "../core/workspace"

const migrateCommand = "storyboard.cards.migrateTextToList"

export function registerMigrateCardTextCommand(dependencies: {
  readonly logger: StoryboardLogger
}): vscode.Disposable {
  return vscode.commands.registerCommand(migrateCommand, () => runMigrate(dependencies.logger))
}

async function runMigrate(logger: StoryboardLogger): Promise<void> {
  const workspaceFolder = await getTargetWorkspaceFolder()

  if (!workspaceFolder) {
    return
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showWarningMessage("Storyboard 프로젝트가 아닙니다.")
    return
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri)
  let migratedCount = 0

  for (const directory of [paths.characterDirectory, paths.backgroundDirectory]) {
    migratedCount += await migrateCardsInDirectory(directory, logger)
  }

  if (migratedCount === 0) {
    await vscode.window.showInformationMessage("목록형으로 변환할 카드가 없습니다.")
    return
  }

  await vscode.window.showInformationMessage(`${migratedCount}개 카드를 목록형으로 변환했습니다.`)
}

async function migrateCardsInDirectory(directory: vscode.Uri, logger: StoryboardLogger): Promise<number> {
  let entries: [string, vscode.FileType][]

  try {
    entries = await vscode.workspace.fs.readDirectory(directory)
  } catch {
    return 0
  }

  let migratedCount = 0

  for (const [fileName, fileType] of entries) {
    if (fileType !== vscode.FileType.File || !fileName.endsWith(".card") || isIgnoredSampleCardFileName(fileName)) {
      continue
    }

    const cardUri = vscode.Uri.joinPath(directory, fileName)

    try {
      const rawYaml = new TextDecoder().decode(await vscode.workspace.fs.readFile(cardUri))
      const result = migrateCardTextFieldsToList(rawYaml)

      if (result.changed) {
        await vscode.workspace.fs.writeFile(cardUri, new TextEncoder().encode(result.yaml))
        migratedCount += 1
      }
    } catch (error) {
      logger.warn(`카드 마이그레이션 실패: ${fileName} — ${String(error)}`)
    }
  }

  return migratedCount
}
