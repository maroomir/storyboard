import * as vscode from "vscode"

import { type StoryboardProjectPaths } from "./pathConventions"
import { uriExists } from "./workspace"
import {
  createEmptyRevisionPlan,
  readRevisionPlanFile,
  upsertRevisionEntry,
  writeRevisionPlanFile,
  type RevisionPlan,
  type RevisionPlanEntry,
  type RevisionPlanFileSystem
} from "../files/revisionPlan"

const fileSystem: RevisionPlanFileSystem = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> => vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content)
}

export async function recordRevisionEntry(
  paths: StoryboardProjectPaths,
  entry: RevisionPlanEntry
): Promise<void> {
  const current = await readRevisionPlanOrEmpty(paths.outlineRevisionPlan)
  const next = upsertRevisionEntry(current, entry)

  await vscode.workspace.fs.createDirectory(paths.outlineDirectory)
  await writeRevisionPlanFile(paths.outlineRevisionPlan, fileSystem, next)
}

async function readRevisionPlanOrEmpty(uri: vscode.Uri): Promise<RevisionPlan> {
  if (!(await uriExists(uri))) {
    return createEmptyRevisionPlan()
  }

  try {
    return await readRevisionPlanFile(uri, fileSystem)
  } catch {
    return createEmptyRevisionPlan()
  }
}
