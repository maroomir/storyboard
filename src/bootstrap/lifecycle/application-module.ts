import type * as vscode from 'vscode';

export interface IApplicationModule extends vscode.Disposable {
  initialize(context: vscode.ExtensionContext): void;
}
