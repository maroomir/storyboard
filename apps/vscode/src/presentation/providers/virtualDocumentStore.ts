import * as vscode from 'vscode';

export class VirtualDocumentStore implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly contentByUri = new Map<string, string>();

  public readonly onDidChange = this.changeEmitter.event;

  public provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentByUri.get(uri.toString()) ?? '';
  }

  public setContent(uri: vscode.Uri, content: string): void {
    this.contentByUri.set(uri.toString(), content);
    this.changeEmitter.fire(uri);
  }

  public dispose(): void {
    this.contentByUri.clear();
    this.changeEmitter.dispose();
  }
}
