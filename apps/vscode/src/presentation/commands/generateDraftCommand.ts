import { storyboardCommandIds } from '@/contributionIds';
import * as vscode from 'vscode';

import {
  GenerateDraftCommandBase,
  type GenerateDraftCommandDependencies,
} from '@/presentation/commands/generateDraftCommandBase';

export class GenerateDraftCommand extends GenerateDraftCommandBase {
  public readonly id: string = storyboardCommandIds.draftGenerate;

  public constructor(dependencies: GenerateDraftCommandDependencies) {
    super(dependencies);
  }

  public run(uri?: vscode.Uri): Promise<void> {
    return this.generate(uri, { shouldOverwrite: false });
  }
}
