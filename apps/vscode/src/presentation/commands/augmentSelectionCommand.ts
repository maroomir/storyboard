import { storyboardCommandIds } from '@/contributionIds';
import * as vscode from 'vscode';

import {
  AugmentDraftCommandBase,
  type AugmentDraftCommandDependencies,
} from '@/presentation/commands/augmentDraftCommandBase';
import type { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';

export class AugmentSelectionCommand extends AugmentDraftCommandBase {
  public readonly id: string = storyboardCommandIds.draftAugmentSelection;

  public constructor(
    dependencies: AugmentDraftCommandDependencies,
    previewProvider: VirtualDocumentStore,
  ) {
    super(dependencies, previewProvider);
  }

  public run(sceneUri?: vscode.Uri, draftUri?: vscode.Uri, rangeArg?: vscode.Range): Promise<void> {
    return this.augment('selection', sceneUri, draftUri, rangeArg);
  }
}
