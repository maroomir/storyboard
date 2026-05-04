import * as vscode from "vscode"

import { getStoryboardProjectPaths } from "./pathConventions"

export async function getTargetWorkspaceFolder(): Promise<vscode.WorkspaceFolder | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? []

  if (workspaceFolders.length === 0) {
    await vscode.window.showErrorMessage("Storyboard 프로젝트를 초기화하려면 먼저 폴더를 열어 주세요.")
    return undefined
  }

  if (workspaceFolders.length === 1) {
    return workspaceFolders[0]
  }

  const selectedFolder = await vscode.window.showQuickPick(
    workspaceFolders.map((folder) => ({ label: folder.name, folder })),
    { placeHolder: "Storyboard 프로젝트를 초기화할 워크스페이스 폴더를 선택하세요." }
  )

  return selectedFolder?.folder
}

export async function hasStoryboardProject(workspaceFolder: vscode.WorkspaceFolder): Promise<boolean> {
  const paths = getStoryboardProjectPaths(workspaceFolder.uri)
  return uriExists(paths.projectJson)
}

export async function resolveStoryboardWorkspaceRoot(): Promise<vscode.Uri | undefined> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (await hasStoryboardProject(folder)) {
      return folder.uri
    }
  }

  return undefined
}

export async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri)
    return true
  } catch {
    return false
  }
}

export async function ensureUriDoesNotExist(uri: vscode.Uri, message: string): Promise<boolean> {
  if (await uriExists(uri)) {
    await vscode.window.showWarningMessage(message)
    return false
  }

  return true
}