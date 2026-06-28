import * as vscode from "vscode"

import { hasStoryboardProject } from "../core/workspace"
import { isDirectSceneTextFile, isDraftMarkdownFile, sceneFilePath } from "../core/pathConventions"
import { tryParseDraftScenePartsForCodeLens } from "./draftCodeLensLogic"

const regenerateDraftCommand = "storyboard.draft.regenerate"
const grammarCheckCommand = "storyboard.draft.grammarCheck"
const continuityCheckCommand = "storyboard.draft.continuityCheck"
const expandDraftCommand = "storyboard.draft.expand"
const augmentDraftCommand = "storyboard.draft.augment"
const augmentSelectionCommand = "storyboard.draft.augmentSelection"
const editSelectionCommand = "storyboard.draft.editSelection"

export class DraftCodeLensProvider implements vscode.CodeLensProvider {
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

    if (!isDraftMarkdownFile(document.uri, workspaceFolder)) {
      return []
    }

    const nameParts = tryParseDraftScenePartsForCodeLens(document.getText())

    if (!nameParts) {
      return []
    }

    const sceneUri = sceneFilePath(workspaceFolder.uri, nameParts.orderText, nameParts.slug)

    if (!isDirectSceneTextFile(sceneUri, workspaceFolder)) {
      return []
    }

    const range = document.lineAt(0).range

    return [
      new vscode.CodeLens(range, {
        title: "🔁 Re-generate Draft",
        tooltip: "연결된 씬 파일 기준으로 초안을 다시 생성합니다.",
        command: regenerateDraftCommand,
        arguments: [sceneUri]
      }),
      new vscode.CodeLens(range, {
        title: "🩹 Grammar Check",
        tooltip: "현재 드래프트 본문의 문법 이슈를 진단합니다.",
        command: grammarCheckCommand,
        arguments: [document.uri]
      }),
      new vscode.CodeLens(range, {
        title: "🧭 Continuity Check",
        tooltip: "스토리 바이블의 정전 설정과 본문이 모순되는지 진단합니다.",
        command: continuityCheckCommand,
        arguments: [document.uri]
      }),
      new vscode.CodeLens(range, {
        title: "🌿 Expand",
        tooltip: "현재 선택한 영역을 문체를 유지한 채 확장합니다.",
        command: expandDraftCommand,
        arguments: [
          document.uri,
          vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString()
            ? new vscode.Range(
                vscode.window.activeTextEditor.selection.start,
                vscode.window.activeTextEditor.selection.end
              )
            : undefined
        ]
      }),
      new vscode.CodeLens(range, {
        title: "✨ Augment from Cards",
        tooltip: "재생성 없이 현재 카드·설정을 본문 전체에 반영해 보충합니다.",
        command: augmentDraftCommand,
        arguments: [sceneUri, document.uri]
      }),
      new vscode.CodeLens(range, {
        title: "🪄 Update Selection",
        tooltip: "선택한 영역만 현재 카드·설정 기준으로 보충합니다.",
        command: augmentSelectionCommand,
        arguments: [
          sceneUri,
          document.uri,
          vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString()
            ? new vscode.Range(
                vscode.window.activeTextEditor.selection.start,
                vscode.window.activeTextEditor.selection.end
              )
            : undefined
        ]
      }),
      new vscode.CodeLens(range, {
        title: "✏️ Edit Selection...",
        tooltip: "선택한 영역을 지시문 기반으로 수정합니다. 클릭하면 수정 방향을 입력하는 창이 열립니다.",
        command: editSelectionCommand,
        arguments: [
          sceneUri,
          document.uri,
          vscode.window.activeTextEditor?.document.uri.toString() === document.uri.toString()
            ? new vscode.Range(
                vscode.window.activeTextEditor.selection.start,
                vscode.window.activeTextEditor.selection.end
              )
            : undefined
        ]
      })
    ]
  }
}

export function registerDraftCodeLensProvider(): vscode.Disposable {
  const provider = new DraftCodeLensProvider()
  const selector: vscode.DocumentSelector = { scheme: "file", pattern: "**/draft/*.md" }

  const registration = vscode.languages.registerCodeLensProvider(selector, provider)
  const watchers: vscode.FileSystemWatcher[] = []

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, "draft/**/*.md"))

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
