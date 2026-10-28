import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import { renameCharacterCommand, renameCard } from '@/presentation/commands/renameCard';

export class RenameCharacterCardCommand implements IExtensionCommand {
  public readonly id: string = renameCharacterCommand;

  public run(uri?: vscode.Uri): Promise<void> {
    return renameCard('character', uri);
  }
}
