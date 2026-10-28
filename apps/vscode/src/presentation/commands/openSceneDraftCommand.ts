import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import { openDraftForScene, openSceneDraftCommand } from '@/presentation/commands/newScene';

export class OpenSceneDraftCommand implements IExtensionCommand {
  public readonly id: string = openSceneDraftCommand;

  public run(uri?: vscode.Uri): Promise<void> {
    return openDraftForScene(uri);
  }
}
