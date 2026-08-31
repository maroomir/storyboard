import * as vscode from 'vscode';

import type { ContinuityIssue, GrammarIssue } from '@storyboard/story-ai';

import { mapContinuityIssuesToDiagnostics } from './ContinuityDiagnosticsProvider';
import { mapGrammarIssuesToDiagnostics } from './GrammarDiagnosticsProvider';

// NOTE: chat tool runs publish into their own collections but under the same sources as the
// diagnostic commands, so squiggles and grammar quick fixes look identical either way.
export class StudioToolDiagnostics implements vscode.Disposable {
  private readonly continuityCollection = vscode.languages.createDiagnosticCollection(
    'storyboard-studio-continuity',
  );
  private readonly grammarCollection = vscode.languages.createDiagnosticCollection(
    'storyboard-studio-grammar',
  );
  private readonly closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    this.continuityCollection.delete(document.uri);
    this.grammarCollection.delete(document.uri);
  });

  public async publishContinuity(
    uri: vscode.Uri,
    issues: readonly ContinuityIssue[],
  ): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    this.continuityCollection.set(uri, mapContinuityIssuesToDiagnostics(document, issues));
  }

  public async publishGrammar(uri: vscode.Uri, issues: readonly GrammarIssue[]): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    this.grammarCollection.set(uri, mapGrammarIssuesToDiagnostics(document, issues));
  }

  public dispose(): void {
    this.continuityCollection.dispose();
    this.grammarCollection.dispose();
    this.closeListener.dispose();
  }
}
