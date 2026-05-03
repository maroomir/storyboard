import * as vscode from "vscode"

import { draftPath } from "../core/pathConventions"
import { hasStoryboardProject, uriExists } from "../core/workspace"
import { parseSceneFileName } from "../shared/scene"

const generateDraftCommand = "storyboard.draft.generate"
const regenerateDraftCommand = "storyboard.draft.regenerate"
const applyDraftFormatCommand = "storyboard.draft.applyFormat"

function isDirectSceneTextFile(sceneUri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): boolean {
  const sceneDir = vscode.Uri.joinPath(workspaceFolder.uri, "scene")
  const dirPath = sceneDir.fsPath.replace(/\\/g, "/").toLowerCase()
  const filePath = sceneUri.fsPath.replace(/\\/g, "/").toLowerCase()

  if (!filePath.startsWith(`${dirPath}/`)) {
    return false
  }

  const remainder = filePath.slice(dirPath.length + 1)
  return !remainder.includes("/") && remainder.endsWith(".txt")
}

export class SceneCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>()

  public readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event

  public refresh(): void {
    this._onDidChangeCodeLenses.fire()
  }

  public async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (document.uri.scheme !== "file") {
      return []
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)

    if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
      return []
    }

    if (!isDirectSceneTextFile(document.uri, workspaceFolder)) {
      return []
    }

    const fileName = document.uri.path.split("/").pop() ?? ""
    const nameParts = parseSceneFileName(fileName)

    if (!nameParts) {
      return []
    }

    const draftUri = draftPath(workspaceFolder.uri, nameParts.stem)
    const draftExists = await uriExists(draftUri)
    const range = document.lineAt(0).range

    const lenses: vscode.CodeLens[] = []

    lenses.push(
      new vscode.CodeLens(range, {
        title: draftExists ? "🔄 Regenerate Draft" : "▶ Generate Draft",
        tooltip: draftExists ? "현재 입력으로 초안을 다시 생성합니다." : "초안을 생성합니다.",
        command: draftExists ? regenerateDraftCommand : generateDraftCommand,
        arguments: [document.uri]
      })
    )

    if (draftExists) {
      lenses.push(
        new vscode.CodeLens(range, {
          title: "🎭 Apply Format",
          tooltip: "프로젝트 장르에 맞게 초안 본문 포맷만 다시 적용합니다.",
          command: applyDraftFormatCommand,
          arguments: [document.uri]
        })
      )
    }

    return lenses
  }
}

export function registerSceneCodeLensProvider(): vscode.Disposable {
  const provider = new SceneCodeLensProvider()
  const selector: vscode.DocumentSelector = { scheme: "file", pattern: "**/scene/*.txt" }

  const registration = vscode.languages.registerCodeLensProvider(selector, provider)
  const watchers: vscode.FileSystemWatcher[] = []

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, "draft/**/*.md")
    )

    const fire = (): void => {
      provider.refresh()
    }

    watcher.onDidChange(fire)
    watcher.onDidCreate(fire)
    watcher.onDidDelete(fire)
    watchers.push(watcher)
  }

  const folderChange = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    provider.refresh()
  })

  return vscode.Disposable.from(registration, folderChange, ...watchers)
}
