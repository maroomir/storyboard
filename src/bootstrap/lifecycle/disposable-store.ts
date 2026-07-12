import type * as vscode from 'vscode';

export class DisposableStore implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];

  public add(...disposables: vscode.Disposable[]): void {
    this.disposables.push(...disposables);
  }

  public dispose(): void {
    for (const disposable of this.disposables.splice(0).reverse()) {
      disposable.dispose();
    }
  }
}
