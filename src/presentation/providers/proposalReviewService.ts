import * as vscode from 'vscode';

import { VirtualDocumentStore } from './virtualDocumentStore';

const proposalPreviewScheme = 'storyboard-proposal';

export interface ProposalReviewItem {
  readonly original: vscode.Uri | undefined;
  readonly proposedText: string;
  readonly label: string;
  readonly key: string;
}

export class ProposalReviewService implements vscode.Disposable {
  private readonly store = new VirtualDocumentStore();

  public constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      this.store,
      vscode.workspace.registerTextDocumentContentProvider(proposalPreviewScheme, this.store),
    );
  }

  public async showDiffs(items: readonly ProposalReviewItem[]): Promise<void> {
    for (const item of items) {
      const proposedUri = vscode.Uri.parse(
        `${proposalPreviewScheme}:${encodeURIComponent(item.key)}`,
      );
      this.store.setContent(proposedUri, item.proposedText);
      const originalUri =
        item.original ??
        vscode.Uri.parse(`${proposalPreviewScheme}:${encodeURIComponent(`${item.key}:empty`)}`);
      if (!item.original) {
        this.store.setContent(originalUri, '');
      }
      await vscode.commands.executeCommand('vscode.diff', originalUri, proposedUri, item.label, {
        preview: true,
      });
    }
  }

  public dispose(): void {
    this.store.dispose();
  }
}
