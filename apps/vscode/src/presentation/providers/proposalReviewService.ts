import * as vscode from 'vscode';

import { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';

const proposalPreviewScheme: string = 'storyboard-proposal';

export interface ProposalReviewItem {
  readonly original: vscode.Uri | undefined;
  readonly originalText?: string;
  readonly proposedText: string;
  readonly label: string;
  readonly key: string;
}

export class ProposalReviewService implements vscode.Disposable {
  private readonly store: VirtualDocumentStore = new VirtualDocumentStore();

  public constructor(context: vscode.ExtensionContext) {
    context.subscriptions.push(
      this.store,
      vscode.workspace.registerTextDocumentContentProvider(proposalPreviewScheme, this.store),
    );
  }

  public async showDiffs(items: readonly ProposalReviewItem[]): Promise<void> {
    for (const item of items) {
      const proposedUri: vscode.Uri = vscode.Uri.parse(
        `${proposalPreviewScheme}:${encodeURIComponent(item.key)}`,
      );
      this.store.setContent(proposedUri, item.proposedText);
      const isTextOriginal: boolean =
        item.original === undefined || item.originalText !== undefined;
      const originalUri: vscode.Uri =
        isTextOriginal || item.original === undefined
          ? vscode.Uri.parse(
              `${proposalPreviewScheme}:${encodeURIComponent(`${item.key}:original`)}`,
            )
          : item.original;
      if (isTextOriginal) {
        this.store.setContent(originalUri, item.originalText ?? '');
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
