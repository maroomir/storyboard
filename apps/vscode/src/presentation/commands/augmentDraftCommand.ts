import { storyboardCommandIds } from '@/contributionIds';
import * as vscode from 'vscode';

import {
  AugmentDraftCommandBase,
  type AugmentDraftCommandDependencies,
} from '@/presentation/commands/augmentDraftCommandBase';
import type { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';

export class AugmentDraftCommand extends AugmentDraftCommandBase {
  public readonly id: string = storyboardCommandIds.draftAugment;

  public constructor(
    dependencies: AugmentDraftCommandDependencies,
    previewProvider: VirtualDocumentStore,
  ) {
    super(dependencies, previewProvider);
  }

  public run(sceneUri?: vscode.Uri, draftUri?: vscode.Uri): Promise<void> {
    return this.augment('draft', sceneUri, draftUri);
  }
}
