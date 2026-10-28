import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import {
  GENERATE_DRAFT_COMMAND,
  runCommand,
  type GenerateDraftCommandDependencies,
} from '@/presentation/commands/generateDraft';

export class GenerateDraftCommand implements IExtensionCommand {
  public readonly id: string = GENERATE_DRAFT_COMMAND;

  public constructor(private readonly dependencies: GenerateDraftCommandDependencies) {}

  public run(uri?: vscode.Uri): Promise<void> {
    return runCommand(uri, false, this.dependencies);
  }
}
