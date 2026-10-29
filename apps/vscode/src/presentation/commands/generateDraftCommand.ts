import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import {
  runCommand,
  type GenerateDraftCommandDependencies,
} from '@/presentation/commands/generateDraft';

export class GenerateDraftCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.draftGenerate;

  public constructor(private readonly dependencies: GenerateDraftCommandDependencies) {}

  public run(uri?: vscode.Uri): Promise<void> {
    return runCommand(uri, false, this.dependencies);
  }
}
