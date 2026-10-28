import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import {
  CONDENSE_DRAFT_COMMAND,
  runCondenseDraft,
  type CondenseDraftCommandDependencies,
} from '@/presentation/commands/condenseDraft';
import type { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';

export class CondenseDraftCommand implements IExtensionCommand {
  public readonly id: string = CONDENSE_DRAFT_COMMAND;

  public constructor(
    private readonly dependencies: CondenseDraftCommandDependencies,
    private readonly previewProvider: VirtualDocumentStore,
  ) {}

  public run(uri?: vscode.Uri): Promise<void> {
    return runCondenseDraft(this.dependencies, this.previewProvider, uri);
  }
}
