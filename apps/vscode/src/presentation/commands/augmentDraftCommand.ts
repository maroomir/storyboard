import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import {
  runAugmentDraft,
  type AugmentDraftCommandDependencies,
} from '@/presentation/commands/augmentDraft';
import type { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';

export class AugmentDraftCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.draftAugment;

  public constructor(
    private readonly dependencies: AugmentDraftCommandDependencies,
    private readonly previewProvider: VirtualDocumentStore,
  ) {}

  public run(sceneUri?: vscode.Uri, draftUri?: vscode.Uri): Promise<void> {
    return runAugmentDraft('draft', this.dependencies, this.previewProvider, sceneUri, draftUri);
  }
}
