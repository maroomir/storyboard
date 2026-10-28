import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import { renameBackgroundCommand, renameCard } from '@/presentation/commands/renameCard';

export class RenameBackgroundCardCommand implements IExtensionCommand {
  public readonly id: string = renameBackgroundCommand;

  public run(uri?: vscode.Uri): Promise<void> {
    return renameCard('background', uri);
  }
}
