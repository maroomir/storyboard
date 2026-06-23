import * as vscode from "vscode"

import { type StoryboardLogger } from "../core/logger"
import { type StoryboardProjectPaths } from "../core/pathConventions"
import { uriExists } from "../core/workspace"
import { normalizeRelativePath, SeedWriteAbortedError, type SeedFileWriteEntry } from "../files/seedImport"
import { createWorkspaceReadme } from "./init"

export function uriForRelativeProjectPath(root: vscode.Uri, relativePath: string): vscode.Uri {
  const segments = relativePath.split("/").filter((s) => s.length > 0)
  return vscode.Uri.joinPath(root, ...segments)
}

export async function readSeedFile(uri: vscode.Uri): Promise<Uint8Array> {
  return vscode.workspace.fs.readFile(uri)
}

export async function readExistingContentByRelativePathForPlan(
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

export async function writeSeedPlanEntries(
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

export async function deleteRelativePaths(root: vscode.Uri, relativePaths: readonly string[]): Promise<void> {
  for (const relativePath of relativePaths) {
    const target = uriForRelativeProjectPath(root, relativePath)

    if (await uriExists(target)) {
      await vscode.workspace.fs.delete(target)
    }
  }
}

export async function writeReadmeIfMissing(paths: StoryboardProjectPaths, projectName: string): Promise<void> {
  if (await uriExists(paths.readme)) {
    return
  }

  await vscode.workspace.fs.writeFile(paths.readme, new TextEncoder().encode(createWorkspaceReadme(projectName)))
}
