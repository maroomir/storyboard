import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import {
  runAugmentDraft,
  type AugmentDraftCommandDependencies,
} from '@/presentation/commands/augmentDraft';
import type { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';

export class AugmentSelectionCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.draftAugmentSelection;

  public constructor(
    private readonly dependencies: AugmentDraftCommandDependencies,
    private readonly previewProvider: VirtualDocumentStore,
  ) {}

  public run(sceneUri?: vscode.Uri, draftUri?: vscode.Uri, rangeArg?: vscode.Range): Promise<void> {
    return runAugmentDraft(
      'selection',
      this.dependencies,
      this.previewProvider,
      sceneUri,
      draftUri,
      rangeArg,
    );
  }
}
