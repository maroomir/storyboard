import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import {
  REGENERATE_DRAFT_COMMAND,
  runCommand,
  type GenerateDraftCommandDependencies,
} from '@/presentation/commands/generateDraft';

export class RegenerateDraftCommand implements IExtensionCommand {
  public readonly id: string = REGENERATE_DRAFT_COMMAND;

  public constructor(private readonly dependencies: GenerateDraftCommandDependencies) {}

  public run(uri?: vscode.Uri): Promise<void> {
    return runCommand(uri, true, this.dependencies);
  }
}
