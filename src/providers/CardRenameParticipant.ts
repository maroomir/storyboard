import * as vscode from "vscode"

import {
  appendCardRenameWorkspaceEdit,
  CardRenameValidationError,
  parseCardRenameCandidate
} from "../core/cardRenameEdit"

export function registerCardRenameParticipant(): vscode.Disposable {
  return vscode.workspace.onWillRenameFiles((event) => {
    const cardRenames = event.files.filter(
      (file) => parseCardRenameCandidate(file.oldUri, file.newUri) !== undefined
    )

    if (cardRenames.length === 0) {
      return
    }

    event.waitUntil(applyCardRenames(cardRenames))
  })
}

async function applyCardRenames(
  files: readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[]
): Promise<vscode.WorkspaceEdit | undefined> {
  const combinedEdit = new vscode.WorkspaceEdit()

  for (const file of files) {
    try {
      await appendCardRenameWorkspaceEdit(combinedEdit, file.oldUri, file.newUri)
    } catch (error) {
      const message =
        error instanceof CardRenameValidationError
          ? error.message
          : "카드 rename을 적용할 수 없어 원래 파일명을 유지합니다."

      void vscode.window.showWarningMessage(message)
      throw error
    }
  }

  return combinedEdit
}
