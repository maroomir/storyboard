import { storyboardCommandIds } from '@/contributionIds';
import * as vscode from 'vscode';

import { RenameCardCommandBase } from '@/presentation/commands/renameCardCommandBase';

export class RenameCharacterCardCommand extends RenameCardCommandBase {
  public readonly id: string = storyboardCommandIds.characterRename;

  public run(uri?: vscode.Uri): Promise<void> {
    return this.rename('character', uri);
  }
}
