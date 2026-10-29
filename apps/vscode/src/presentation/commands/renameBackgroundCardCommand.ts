import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import { renameCard } from '@/presentation/commands/renameCard';

export class RenameBackgroundCardCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.backgroundRename;

  public run(uri?: vscode.Uri): Promise<void> {
    return renameCard('background', uri);
  }
}
