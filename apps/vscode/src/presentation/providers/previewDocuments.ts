import * as vscode from 'vscode';

import { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';

export class PreviewDocuments {
  public readonly store: VirtualDocumentStore = new VirtualDocumentStore();

  public constructor(private readonly scheme: string) {}

  public register(): vscode.Disposable {
    return vscode.Disposable.from(
      this.store,
      vscode.workspace.registerTextDocumentContentProvider(this.scheme, this.store),
    );
  }
}
