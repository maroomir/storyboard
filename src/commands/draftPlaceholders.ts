import * as vscode from "vscode"

const phase6Notice = "이 기능은 Phase 6에서 제공될 예정입니다."

function showPhase6Placeholder(): void {
  void vscode.window.showInformationMessage(phase6Notice)
}

export function registerDraftPlaceholderCommands(): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand("storyboard.draft.grammarCheck", showPhase6Placeholder),
    vscode.commands.registerCommand("storyboard.draft.expand", showPhase6Placeholder)
  )
}
