import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import {
  runCondenseDraft,
  type CondenseDraftCommandDependencies,
} from '@/presentation/commands/condenseDraft';
import type { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';

export class CondenseDraftCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.draftCondense;

  public constructor(
    private readonly dependencies: CondenseDraftCommandDependencies,
    private readonly previewProvider: VirtualDocumentStore,
  ) {}

  public run(uri?: vscode.Uri): Promise<void> {
    return runCondenseDraft(this.dependencies, this.previewProvider, uri);
  }
}
