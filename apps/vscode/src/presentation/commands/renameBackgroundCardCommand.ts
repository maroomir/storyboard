import { storyboardCommandIds } from '@/contributionIds';
import * as vscode from 'vscode';

import { RenameCardCommandBase } from '@/presentation/commands/renameCardCommandBase';

export class RenameBackgroundCardCommand extends RenameCardCommandBase {
  public readonly id: string = storyboardCommandIds.backgroundRename;

  public run(uri?: vscode.Uri): Promise<void> {
    return this.rename('background', uri);
  }
}
