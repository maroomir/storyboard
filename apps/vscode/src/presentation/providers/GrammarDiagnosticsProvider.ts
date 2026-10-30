import { storyboardCommandIds } from '@/contributionIds';
import { DiagnosticsCheckCommand } from '@/presentation/providers/diagnosticsCheckCommand';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { CheckDraftResult } from '@storyboard/story-engine';
import { isDraftMarkdownFile, STORYBOARD_GLOBS, parseDraft } from '@storyboard/story-model';
import {
  createWarningDiagnostic,
  toRange,
  type DiagnosticsProviderDependencies,
} from '@/presentation/providers/diagnosticsShared';
import { hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import { LatestRequestGuard } from '@/presentation/providers/latestRequestGuard';
import type { GrammarIssue } from '@storyboard/story-ai';
import { isTaskProviderReady } from '@/infrastructure/ai/providerReadiness';

const grammarSource: string = 'storyboard-grammar';
const grammarDebounceMs: number = 700;
const quickFixKind: vscode.CodeActionKind = (vscode.CodeActionKind?.QuickFix ??
  'quickfix') as vscode.CodeActionKind;

export function toGrammarRange(
  document: vscode.TextDocument,
  issue: GrammarIssue,
): vscode.Range | undefined {
  return toRange(document, issue.start, issue.end);
}

export function mapGrammarIssuesToDiagnostics(
  document: vscode.TextDocument,
  issues: readonly GrammarIssue[],
): vscode.Diagnostic[] {
  return issues.flatMap((issue) => {
    const range: vscode.Range | undefined = toGrammarRange(document, issue);
    if (!range) {
      return [];
    }

    const message: string = `${issue.reason} → 제안: ${issue.suggestion}`;
    const diagnostic: vscode.Diagnostic = createWarningDiagnostic(range, message, grammarSource);
    diagnostic.code = issue.suggestion;
    return [diagnostic];
  });
}

class GrammarCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds: vscode.CodeActionKind[] = [quickFixKind];

  public provideCodeActions(
    _document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const fixes: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== grammarSource) {
        continue;
      }

      const suggestion: vscode.Diagnostic['code'] = diagnostic.code;
      if (typeof suggestion !== 'string' || suggestion.trim().length === 0) {
        continue;
      }

      const action: vscode.CodeAction = new vscode.CodeAction('문법 수정 적용', quickFixKind);
      action.command = {
        command: storyboardCommandIds.draftApplyGrammarFix,
        title: '문법 수정 적용',
        arguments: [_document.uri, diagnostic.range, suggestion],
      };
      action.diagnostics = [diagnostic];
      fixes.push(action);
    }

    return fixes;
  }
}

class GrammarDiagnosticsController {
  private readonly collection: vscode.DiagnosticCollection =
    vscode.languages.createDiagnosticCollection(grammarSource);
  private readonly latestRequests: LatestRequestGuard = new LatestRequestGuard();

  public constructor(private readonly dependencies: DiagnosticsProviderDependencies) {}

  public getDiagnosticsCollection(): vscode.DiagnosticCollection {
    return this.collection;
  }

  public async runForDocument(document: vscode.TextDocument): Promise<void> {
    if (
      !isTaskProviderReady(this.dependencies.configBridge, 'grammarCheck') ||
      !(await this.canRun(document))
    ) {
      this.collection.delete(document.uri);
      return;
    }
    const workspaceFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(
      document.uri,
    );
    if (!workspaceFolder) {
      this.collection.delete(document.uri);
      return;
    }
    let sceneStem: string = 'unknown-scene';
    try {
      sceneStem = parseDraft(document.getText()).sceneStem;
    } catch {
      const fileName: string = document.uri.path.split('/').pop() ?? '';
      sceneStem = fileName.replace(/\.md$/i, '');
    }

    const draftCheck: CheckDraftResult = await this.dependencies.drafts.check({
      workspaceRoot: workspaceFolder.uri,
      sceneStem,
      kind: 'grammar',
      text: document.getText(),
    });

    if (draftCheck.kind !== 'grammar') {
      this.collection.delete(document.uri);
      return;
    }

    this.collection.set(document.uri, this.toDiagnostics(document, draftCheck.issues));
  }

  public scheduleRealtimeCheck(document: vscode.TextDocument): void {
    this.latestRequests.schedule(
      document.uri.toString(),
      grammarDebounceMs,
      async (): Promise<void> => await this.runForDocument(document),
    );
  }

  public cancelRealtimeCheck(document: vscode.TextDocument): void {
    this.latestRequests.cancel(document.uri.toString());
  }

  public dispose(): void {
    this.latestRequests.dispose();
    this.collection.dispose();
  }

  private async canRun(document: vscode.TextDocument): Promise<boolean> {
    if (document.uri.scheme !== 'file') {
      return false;
    }
    const workspaceFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(
      document.uri,
    );
    if (!workspaceFolder) {
      return false;
    }
    if (!(await hasStoryboardProject(workspaceFolder))) {
      return false;
    }
    return isDraftMarkdownFile(document.uri, workspaceFolder);
  }

  private toDiagnostics(
    document: vscode.TextDocument,
    issues: readonly GrammarIssue[],
  ): vscode.Diagnostic[] {
    return mapGrammarIssuesToDiagnostics(document, issues);
  }
}

async function runApplyGrammarFix(
  uri: vscode.Uri,
  range: vscode.Range,
  suggestion: string,
): Promise<void> {
  const editor: vscode.TextEditor | undefined = vscode.window.visibleTextEditors.find(
    (candidate) => candidate.document.uri.toString() === uri.toString(),
  );

  if (!editor) {
    return;
  }

  await editor.edit((editBuilder) => {
    editBuilder.replace(range, suggestion);
  });
}

class ApplyGrammarFixCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.draftApplyGrammarFix;

  public run(uri: vscode.Uri, range: vscode.Range, suggestion: string): Promise<void> {
    return runApplyGrammarFix(uri, range, suggestion);
  }
}

export class GrammarDiagnosticsProvider {
  private readonly controller: GrammarDiagnosticsController;
  public readonly commands: readonly IExtensionCommand[];

  public constructor(private readonly dependencies: DiagnosticsProviderDependencies) {
    this.controller = new GrammarDiagnosticsController(dependencies);
    this.commands = [
      new DiagnosticsCheckCommand(storyboardCommandIds.draftGrammarCheck, this.controller),
      new ApplyGrammarFixCommand(),
    ];
  }

  public register(): vscode.Disposable {
    const { controller, dependencies } = this;
    const selector: vscode.DocumentSelector = {
      scheme: 'file',
      pattern: STORYBOARD_GLOBS.anyDraftMarkdown,
    };

    const codeActionRegistration: vscode.Disposable = vscode.languages.registerCodeActionsProvider(
      selector,
      new GrammarCodeActionProvider(),
      { providedCodeActionKinds: GrammarCodeActionProvider.providedCodeActionKinds },
    );

    const saveListener: vscode.Disposable = vscode.workspace.onDidSaveTextDocument((document) => {
      void controller.runForDocument(document);
    });
    const changeListener: vscode.Disposable = vscode.workspace.onDidChangeTextDocument((event) => {
      if (!dependencies.configBridge.isGrammarRealtimeEnabled()) {
        return;
      }

      controller.scheduleRealtimeCheck(event.document);
    });
    const closeListener: vscode.Disposable = vscode.workspace.onDidCloseTextDocument((document) => {
      controller.cancelRealtimeCheck(document);
      controller.getDiagnosticsCollection().delete(document.uri);
    });

    return vscode.Disposable.from(
      controller,
      codeActionRegistration,
      saveListener,
      changeListener,
      closeListener,
    );
  }
}
