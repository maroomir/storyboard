import * as vscode from 'vscode';

import {
  appendCardRenameWorkspaceEdit,
  CardRenameValidationError,
  parseCardRenameCandidate,
} from '@/infrastructure/vscode/cardRenameEdit';
import type { IStoryboardLogger } from '@storyboard/story-engine';

interface CardFileRename {
  readonly oldUri: vscode.Uri;
  readonly newUri: vscode.Uri;
}

export class CardRenameParticipant {
  public constructor(private readonly logger: IStoryboardLogger) {}

  public register(): vscode.Disposable {
    return vscode.workspace.onWillRenameFiles((event) => {
      const cardRenames: CardFileRename[] = event.files.filter(
        (file) => parseCardRenameCandidate(file.oldUri, file.newUri) !== undefined,
      );

      if (cardRenames.length === 0) {
        return;
      }

      for (const file of cardRenames) {
        this.logger.info(
          `card rename participant: ${file.oldUri.fsPath} -> ${file.newUri.fsPath} (n=${cardRenames.length})`,
        );
      }

      event.waitUntil(applyCardRenames(cardRenames, this.logger));
    });
  }
}

async function applyCardRenames(
  files: readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[],
  logger: IStoryboardLogger,
): Promise<vscode.WorkspaceEdit | undefined> {
  const combinedEdit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();

  for (const file of files) {
    try {
      await appendCardRenameWorkspaceEdit(combinedEdit, file.oldUri, file.newUri);
    } catch (error) {
      const message: string =
        error instanceof CardRenameValidationError
          ? error.message
          : '카드 rename을 적용할 수 없어 원래 파일명을 유지합니다.';

      logger.error('card rename participant: failed', error);
      void vscode.window.showWarningMessage(message);
      throw error;
    }
  }

  logger.info(`card rename participant: applied edits for ${files.length} card(s)`);

  return combinedEdit;
}
