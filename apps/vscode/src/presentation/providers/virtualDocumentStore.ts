import * as vscode from 'vscode';

export class VirtualDocumentStore implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changeEmitter: vscode.EventEmitter<vscode.Uri> =
    new vscode.EventEmitter<vscode.Uri>();
  private readonly contentByUri: Map<string, string> = new Map<string, string>();

  public readonly onDidChange: vscode.Event<vscode.Uri> = this.changeEmitter.event;

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
