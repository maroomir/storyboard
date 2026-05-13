import * as vscode from "vscode"

import { type StoryboardLogger } from "../core/logger"
import { refreshStoryboardWorkspaceContext } from "../core/storyboardWorkspaceContext"
import { getStoryboardProjectPaths, type StoryboardProjectPaths } from "../core/pathConventions"
import { hasStoryboardProject, uriExists } from "../core/workspace"
import {
  buildSeedWritePlan,
  collectTrackedCardAndSceneRelativePathsFromFileNames,
  computeSeedDeletionCandidates,
  listSeedPlanContentConflictRelativePaths,
  normalizeRelativePath,
  SeedWriteAbortedError,
  type SeedFileWriteEntry
} from "../files/seedImport"
import { readDirectoryFileNamesOnly, readParsedSeedEnvelopeFromWorkspaceRoot } from "../files/seedEnvelopeFromWorkspace"
import { parseSeed, SeedParseError, serializeSeed, type ParsedSeedEnvelope } from "../models/serialization/seedFile"
import {
  createStoryboardDirectories,
  createWorkspaceReadme,
  ensureWorkspaceGitignore
} from "./init"

const createFromSeedCommand = "storyboard.seed.createFromFile"
const syncFromSeedCommand = "storyboard.seed.syncFromFile"
const exportToSeedCommand = "storyboard.seed.exportToFile"

const SEED_DELETE_DETAIL_LOG_THRESHOLD = 8

export interface RegisterImportSeedCommandsDependencies {
  readonly logger: StoryboardLogger
}

export function registerImportSeedCommands(
  dependencies: RegisterImportSeedCommandsDependencies
): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand(createFromSeedCommand, () =>
      createProjectFromSeedFile(dependencies)
    ),
    vscode.commands.registerCommand(syncFromSeedCommand, (resource?: vscode.Uri) =>
      syncProjectFromSeedFile(dependencies, resource)
    ),
    vscode.commands.registerCommand(exportToSeedCommand, () => exportProjectToSeedFile(dependencies))
  )
}

function uriForRelativeProjectPath(root: vscode.Uri, relativePath: string): vscode.Uri {
  const segments = relativePath.split("/").filter((s) => s.length > 0)
  return vscode.Uri.joinPath(root, ...segments)
}

async function collectSeedSyncRelativePaths(workspaceRoot: vscode.Uri): Promise<string[]> {
  const paths = getStoryboardProjectPaths(workspaceRoot)
  const characterFileNames = await readDirectoryFileNamesOnly(paths.characterDirectory)
  const backgroundFileNames = await readDirectoryFileNamesOnly(paths.backgroundDirectory)
  const sceneFileNames = await readDirectoryFileNamesOnly(paths.sceneDirectory)

  return collectTrackedCardAndSceneRelativePathsFromFileNames({
    characterFileNames,
    backgroundFileNames,
    sceneFileNames
  })
}

async function readSeedFile(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri)
  return new TextDecoder().decode(bytes)
}

function formatSeedParseFailureMessage(error: unknown): string {
  if (error instanceof SeedParseError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return "Seed 파일을 처리하는 중 알 수 없는 오류가 발생했습니다."
}

async function pickSeedFileUri(): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: false,
    canSelectFiles: true,
    filters: { "Storyboard Seed": ["seed"], "모든 파일": ["*"] },
    openLabel: "Seed 선택"
  })

  return picked?.[0]
}

async function pickTargetDirectoryUri(): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    canSelectFolders: true,
    canSelectFiles: false,
    openLabel: "프로젝트 폴더 선택"
  })

  return picked?.[0]
}

async function pickStoryboardWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const candidates: vscode.WorkspaceFolder[] = []

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (await hasStoryboardProject(folder)) {
      candidates.push(folder)
    }
  }

  if (candidates.length === 0) {
    await vscode.window.showErrorMessage(
      "동기화할 Storyboard 프로젝트가 없습니다. `.storyboard/project.json`이 있는 폴더를 워크스페이스로 열어 주세요."
    )
    return undefined
  }

  if (candidates.length === 1) {
    return candidates[0]
  }

  const picked = await vscode.window.showQuickPick(
    candidates.map((folder) => ({ label: folder.name, folder })),
    { placeHolder: "Seed를 적용할 Storyboard 프로젝트 폴더를 선택하세요." }
  )

  return picked?.folder
}

async function readExistingContentByRelativePathForPlan(
  root: vscode.Uri,
  plan: readonly SeedFileWriteEntry[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>()

  for (const entry of plan) {
    const norm = normalizeRelativePath(entry.relativePath)
    const target = uriForRelativeProjectPath(root, norm)

    if (await uriExists(target)) {
      const bytes = await vscode.workspace.fs.readFile(target)
      map.set(norm, new TextDecoder().decode(bytes))
    }
  }

  return map
}

async function writeSeedPlanEntries(
  root: vscode.Uri,
  entries: readonly SeedFileWriteEntry[],
  logger: StoryboardLogger
): Promise<void> {
  const written: string[] = []

  for (const entry of entries) {
    try {
      const target = uriForRelativeProjectPath(root, entry.relativePath)
      await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(entry.content))
      written.push(entry.relativePath)
    } catch (error) {
      logger.error(
        `Seed 파일 쓰기가 중단되었습니다. 이미 반영된 경로 (${written.length}개): ${written.join(", ")}`,
        error
      )
      throw new SeedWriteAbortedError("Seed 파일 쓰기가 중단되었습니다.", written, { cause: error })
    }
  }
}

async function deleteRelativePaths(root: vscode.Uri, relativePaths: readonly string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    const target = uriForRelativeProjectPath(root, relativePath)

    if (await uriExists(target)) {
      await vscode.workspace.fs.delete(target)
    }
  }
}

async function confirmOrAbortStoryboardMetadataWithoutProjectJson(
  paths: StoryboardProjectPaths
): Promise<boolean> {
  const hasMetadata = await uriExists(paths.metadataDirectory)
  const hasProject = await uriExists(paths.projectJson)

  if (!hasMetadata || hasProject) {
    return true
  }

  const choice = await vscode.window.showWarningMessage(
    "`.storyboard` 폴더는 있지만 `project.json`이 없습니다. Seed를 적용하면 `project.json`과 Seed에 포함된 파일이 생성됩니다. 계속하시겠습니까?",
    { modal: true },
    "계속",
    "취소"
  )

  return choice === "계속"
}

async function confirmOverwriteDifferentSeedContent(conflicts: readonly string[]): Promise<boolean> {
  if (conflicts.length === 0) {
    return true
  }

  const choice = await vscode.window.showWarningMessage(
    `Seed와 내용이 다른 기존 파일이 ${conflicts.length}개 있습니다. 덮어쓰시겠습니까?`,
    { modal: true, detail: conflicts.slice(0, 12).join("\n") },
    "덮어쓰기",
    "취소"
  )

  return choice === "덮어쓰기"
}

async function confirmOverwriteExistingSeedTargets(
  root: vscode.Uri,
  entries: readonly SeedFileWriteEntry[]
): Promise<boolean> {
  const conflicts: string[] = []

  for (const entry of entries) {
    const target = uriForRelativeProjectPath(root, entry.relativePath)

    if (await uriExists(target)) {
      conflicts.push(entry.relativePath)
    }
  }

  if (conflicts.length === 0) {
    return true
  }

  const choice = await vscode.window.showWarningMessage(
    `Seed가 쓰려는 경로 중 ${conflicts.length}개에 이미 파일이 있습니다. 덮어쓰시겠습니까?`,
    { modal: true, detail: conflicts.slice(0, 12).join("\n") },
    "덮어쓰기",
    "취소"
  )

  return choice === "덮어쓰기"
}

async function confirmSeedDeletionCandidates(
  deletions: readonly string[],
  logger: StoryboardLogger
): Promise<boolean> {
  if (deletions.length === 0) {
    return true
  }

  if (deletions.length > SEED_DELETE_DETAIL_LOG_THRESHOLD) {
    logger.info(`Seed 동기화: 삭제 예정 파일 ${deletions.length}개 (전체 목록)`)

    for (const path of deletions) {
      logger.info(`  - ${path}`)
    }
  }

  const preview =
    deletions.length <= SEED_DELETE_DETAIL_LOG_THRESHOLD
      ? deletions.join("\n")
      : `${deletions.slice(0, SEED_DELETE_DETAIL_LOG_THRESHOLD).join("\n")}\n... 외 ${deletions.length - SEED_DELETE_DETAIL_LOG_THRESHOLD}개 (나머지는 Output의 Storyboard 채널에 기록됨)`

  const choice = await vscode.window.showWarningMessage(
    `Seed에 없는 기존 카드/씬 파일 ${deletions.length}개를 삭제합니다. 계속하시겠습니까?`,
    { modal: true, detail: preview },
    "삭제",
    "취소"
  )

  return choice === "삭제"
}

async function writeReadmeIfMissing(paths: StoryboardProjectPaths, projectName: string): Promise<void> {
  if (await uriExists(paths.readme)) {
    return
  }

  await vscode.workspace.fs.writeFile(paths.readme, new TextEncoder().encode(createWorkspaceReadme(projectName)))
}

function isTargetRootInsideWorkspace(targetRoot: vscode.Uri): boolean {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const folderPosix = folder.uri.fsPath.replace(/\\/g, "/").replace(/\/$/, "")
    const targetPosix = targetRoot.fsPath.replace(/\\/g, "/").replace(/\/$/, "")

    if (targetPosix === folderPosix || targetPosix.startsWith(`${folderPosix}/`)) {
      return true
    }
  }

  return false
}

async function offerOpenCreatedFolder(targetRoot: vscode.Uri): Promise<void> {
  if (isTargetRootInsideWorkspace(targetRoot)) {
    return
  }

  const choice = await vscode.window.showInformationMessage(
    "Seed로 프로젝트를 생성했습니다. 다른 폴더에 만들었으면 해당 폴더를 VS Code에서 열어야 합니다.",
    "폴더 열기"
  )

  if (choice === "폴더 열기") {
    await vscode.commands.executeCommand("vscode.openFolder", targetRoot, false)
  }
}

async function createProjectFromSeedFile(
  dependencies: RegisterImportSeedCommandsDependencies
): Promise<void> {
  const seedUri = await pickSeedFileUri()

  if (!seedUri) {
    return
  }

  const targetRoot = await pickTargetDirectoryUri()

  if (!targetRoot) {
    return
  }

  const paths = getStoryboardProjectPaths(targetRoot)

  let raw: string

  try {
    raw = await readSeedFile(seedUri)
  } catch (error) {
    dependencies.logger.error("Seed 파일을 읽지 못했습니다.", error)
    dependencies.logger.show()
    await vscode.window.showErrorMessage("Seed 파일을 읽는 데 실패했습니다. Output 패널을 확인해 주세요.")
    return
  }

  let seed: ParsedSeedEnvelope

  try {
    seed = parseSeed(raw)
  } catch (error) {
    await vscode.window.showErrorMessage(formatSeedParseFailureMessage(error))
    return
  }

  try {
    if (await uriExists(paths.projectJson)) {
      await vscode.window.showInformationMessage("선택한 폴더에 이미 Storyboard 프로젝트(`project.json`)가 있습니다. 중단합니다.")
      return
    }

    if (!(await confirmOrAbortStoryboardMetadataWithoutProjectJson(paths))) {
      return
    }

    const plan = buildSeedWritePlan(seed)

    if (!(await confirmOverwriteExistingSeedTargets(targetRoot, plan))) {
      return
    }

    await createStoryboardDirectories(paths)
    await writeSeedPlanEntries(targetRoot, plan, dependencies.logger)
    await ensureWorkspaceGitignore(paths.gitignore)
    await writeReadmeIfMissing(paths, seed.project.name)
    dependencies.logger.info(`Seed로 프로젝트를 생성했습니다: ${targetRoot.fsPath}`)
    await refreshStoryboardWorkspaceContext()
    await vscode.window.showInformationMessage(`Seed로 Storyboard 프로젝트를 생성했습니다: ${seed.project.name}`)
    await offerOpenCreatedFolder(targetRoot)
  } catch (error) {
    if (error instanceof SeedWriteAbortedError) {
      dependencies.logger.show()
      await vscode.window.showErrorMessage(
        `Seed 반영이 중간에 실패했습니다. 이미 변경된 파일이 ${error.writtenRelativePaths.length}개 있을 수 있습니다. 필요하면 되돌린 뒤 다시 시도하세요. 상세 경로는 Output의 Storyboard 채널을 확인하세요.`
      )
      return
    }

    dependencies.logger.error("Seed 기반 프로젝트 생성에 실패했습니다.", error)
    dependencies.logger.show()
    await vscode.window.showErrorMessage("Seed 기반 프로젝트 생성에 실패했습니다. Output 패널을 확인해 주세요.")
  }
}

async function syncProjectFromSeedFile(
  dependencies: RegisterImportSeedCommandsDependencies,
  seedFileUri?: vscode.Uri
): Promise<void> {
  const workspaceFolder = await pickStoryboardWorkspaceFolder()

  if (!workspaceFolder) {
    return
  }

  const seedUri = seedFileUri ?? (await pickSeedFileUri())

  if (!seedUri) {
    return
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri)

  let raw: string

  try {
    raw = await readSeedFile(seedUri)
  } catch (error) {
    dependencies.logger.error("Seed 파일을 읽지 못했습니다.", error)
    dependencies.logger.show()
    await vscode.window.showErrorMessage("Seed 파일을 읽는 데 실패했습니다. Output 패널을 확인해 주세요.")
    return
  }

  let seed: ParsedSeedEnvelope

  try {
    seed = parseSeed(raw)
  } catch (error) {
    await vscode.window.showErrorMessage(formatSeedParseFailureMessage(error))
    return
  }

  try {
    const existingRelativePaths = await collectSeedSyncRelativePaths(workspaceFolder.uri)
    const deletions = computeSeedDeletionCandidates(existingRelativePaths, seed)
    const plan = buildSeedWritePlan(seed)
    const existingByPath = await readExistingContentByRelativePathForPlan(workspaceFolder.uri, plan)
    const contentConflicts = listSeedPlanContentConflictRelativePaths(plan, existingByPath)

    if (!(await confirmOverwriteDifferentSeedContent(contentConflicts))) {
      return
    }

    if (!(await confirmSeedDeletionCandidates(deletions, dependencies.logger))) {
      return
    }

    await writeSeedPlanEntries(workspaceFolder.uri, plan, dependencies.logger)
    await deleteRelativePaths(workspaceFolder.uri, deletions)
    await ensureWorkspaceGitignore(paths.gitignore)
    dependencies.logger.info(`Seed로 프로젝트를 동기화했습니다: ${workspaceFolder.uri.fsPath}`)
    await refreshStoryboardWorkspaceContext()
    await vscode.window.showInformationMessage(`Seed 내용으로 프로젝트를 동기화했습니다: ${seed.project.name}`)
  } catch (error) {
    if (error instanceof SeedWriteAbortedError) {
      dependencies.logger.show()
      await vscode.window.showErrorMessage(
        `Seed 동기화 중 쓰기가 중단되었습니다. 이미 변경된 파일이 ${error.writtenRelativePaths.length}개 있을 수 있습니다. 필요하면 되돌린 뒤 다시 시도하세요. 상세 경로는 Output의 Storyboard 채널을 확인하세요.`
      )
      return
    }

    dependencies.logger.error("Seed 동기화에 실패했습니다.", error)
    dependencies.logger.show()
    await vscode.window.showErrorMessage("Seed 동기화에 실패했습니다. Output 패널을 확인해 주세요.")
  }
}

async function exportProjectToSeedFile(
  dependencies: RegisterImportSeedCommandsDependencies
): Promise<void> {
  const workspaceFolder = await pickStoryboardWorkspaceFolder()

  if (!workspaceFolder) {
    return
  }

  try {
    const envelope = await readParsedSeedEnvelopeFromWorkspaceRoot(workspaceFolder.uri)
    const raw = serializeSeed(envelope)
    const safeName = envelope.project.name.replace(/[/\\?%*:|"<>]/g, "-").trim() || "storyboard"
    const defaultUri = vscode.Uri.joinPath(workspaceFolder.uri, `${safeName}.seed`)
    const picked = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "Storyboard Seed": ["seed"] },
      saveLabel: "보내기"
    })

    if (!picked) {
      return
    }

    await vscode.workspace.fs.writeFile(picked, new TextEncoder().encode(raw))
    dependencies.logger.info(`Seed 파일을 보냈습니다: ${picked.fsPath}`)
    await vscode.window.showInformationMessage(`Seed 파일을 저장했습니다: ${picked.fsPath}`)
  } catch (error) {
    dependencies.logger.error("Seed 보내기에 실패했습니다.", error)
    dependencies.logger.show()
    await vscode.window.showErrorMessage("Seed 보내기에 실패했습니다. Output 패널을 확인해 주세요.")
  }
}
