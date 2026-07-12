import * as vscode from 'vscode';

import type { StoryboardLogger } from '../core/logger';
import { isDraftMarkdownFile } from '../core/pathConventions';
import { createWarningDiagnostic, toRange } from './diagnosticsShared';
import { hasStoryboardProject } from '../core/workspace';
import { parseDraft } from '../files/draft';
import { StoryboardAIService, type GrammarIssue } from '../services/ai/AIService';
import type { AiProviderRegistry } from '../services/ai/providerRegistry';
import { recordUsageSafely } from '../services/ai/recordUsageSafely';
import type { UsageRecorder } from '../services/ai/UsageRecorder';

const grammarCheckCommand = 'storyboard.draft.grammarCheck';
const applyGrammarFixCommand = 'storyboard.draft.applyGrammarFix';
const grammarSource = 'storyboard-grammar';
const grammarDebounceMs = 700;
const quickFixKind = (vscode.CodeActionKind?.QuickFix ?? 'quickfix') as vscode.CodeActionKind;

export interface RegisterGrammarDiagnosticsProviderDependencies {
  readonly aiProviderRegistry: AiProviderRegistry;
  readonly logger: StoryboardLogger;
  readonly usageRecorder: UsageRecorder;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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
    const range = toGrammarRange(document, issue);
    if (!range) {
      return [];
    }

    const message = `${issue.reason} → 제안: ${issue.suggestion}`;
    const diagnostic = createWarningDiagnostic(range, message, grammarSource);
    diagnostic.code = issue.suggestion;
    return [diagnostic];
  });
}

class GrammarCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [quickFixKind];

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

      const suggestion = diagnostic.code;
      if (typeof suggestion !== 'string' || suggestion.trim().length === 0) {
        continue;
      }

      const action = new vscode.CodeAction('문법 수정 적용', quickFixKind);
      action.command = {
        command: applyGrammarFixCommand,
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
  private readonly collection = vscode.languages.createDiagnosticCollection(grammarSource);
  private readonly aiService: StoryboardAIService;
  private readonly pendingByUri = new Map<string, number>();
  private currentWorkspaceUri: vscode.Uri | undefined;

  public constructor(
    private readonly dependencies: RegisterGrammarDiagnosticsProviderDependencies,
  ) {
    this.aiService = new StoryboardAIService(dependencies.aiProviderRegistry, {
      onUsage: (record): void => {
        if (this.currentWorkspaceUri) {
          recordUsageSafely(
            dependencies.usageRecorder,
            this.currentWorkspaceUri,
            record,
            dependencies.logger,
          );
        }
      },
    });
  }

  public getDiagnosticsCollection(): vscode.DiagnosticCollection {
    return this.collection;
  }

  public async runForDocument(document: vscode.TextDocument): Promise<void> {
    if (!(await this.canRun(document))) {
      this.collection.delete(document.uri);
      return;
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      this.collection.delete(document.uri);
      return;
    }
    this.currentWorkspaceUri = workspaceFolder.uri;

    let sceneStem = 'unknown-scene';
    try {
      sceneStem = parseDraft(document.getText()).sceneStem;
    } catch {
      const fileName = document.uri.path.split('/').pop() ?? '';
      sceneStem = fileName.replace(/\.md$/i, '');
    }

    try {
      const issues = await this.aiService.checkGrammar(document.getText(), {
        providerId: this.dependencies.aiProviderRegistry.getTaskProvider('grammarCheck'),
        attribution: { primary: { kind: 'scene', id: sceneStem } },
      });
      this.collection.set(document.uri, this.toDiagnostics(document, issues));
    } catch (error) {
      this.dependencies.logger.error('Grammar check failed', error);
      this.collection.delete(document.uri);
    }
  }

  public scheduleRealtimeCheck(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const nextToken = (this.pendingByUri.get(key) ?? 0) + 1;
    this.pendingByUri.set(key, nextToken);

    void (async (): Promise<void> => {
      await sleep(grammarDebounceMs);
      if (this.pendingByUri.get(key) !== nextToken) {
        return;
      }
      await this.runForDocument(document);
    })();
  }

  public dispose(): void {
    this.collection.dispose();
  }

  private async canRun(document: vscode.TextDocument): Promise<boolean> {
    if (document.uri.scheme !== 'file') {
      return false;
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
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

async function runGrammarCheckCommand(
  controller: GrammarDiagnosticsController,
  uri?: vscode.Uri,
): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showErrorMessage('활성 드래프트 파일을 찾을 수 없습니다.');
    return;
  }

  const document = await vscode.workspace.openTextDocument(targetUri);
  await controller.runForDocument(document);
}

async function runApplyGrammarFix(
  uri: vscode.Uri,
  range: vscode.Range,
  suggestion: string,
): Promise<void> {
  const editor = vscode.window.visibleTextEditors.find(
    (candidate) => candidate.document.uri.toString() === uri.toString(),
  );

  if (!editor) {
    return;
  }

  await editor.edit((editBuilder) => {
    editBuilder.replace(range, suggestion);
  });
}

export function registerGrammarDiagnosticsProvider(
  dependencies: RegisterGrammarDiagnosticsProviderDependencies,
): vscode.Disposable {
  const controller = new GrammarDiagnosticsController(dependencies);
  const selector: vscode.DocumentSelector = { scheme: 'file', pattern: '**/draft/*.md' };

  const commandRegistration = vscode.commands.registerCommand(
    grammarCheckCommand,
    (uri?: vscode.Uri) => runGrammarCheckCommand(controller, uri),
  );
  const applyFixCommandRegistration = vscode.commands.registerCommand(
    applyGrammarFixCommand,
    (uri: vscode.Uri, range: vscode.Range, suggestion: string) =>
      runApplyGrammarFix(uri, range, suggestion),
  );

  const codeActionRegistration = vscode.languages.registerCodeActionsProvider(
    selector,
    new GrammarCodeActionProvider(),
    { providedCodeActionKinds: GrammarCodeActionProvider.providedCodeActionKinds },
  );

  const saveListener = vscode.workspace.onDidSaveTextDocument((document) => {
    void controller.runForDocument(document);
  });
  const changeListener = vscode.workspace.onDidChangeTextDocument((event) => {
    const realtimeEnabled = vscode.workspace
      .getConfiguration('storyboard')
      .get<boolean>('grammar.realtimeEnabled', false);

    if (!realtimeEnabled) {
      return;
    }

    controller.scheduleRealtimeCheck(event.document);
  });
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    controller.getDiagnosticsCollection().delete(document.uri);
  });

  return vscode.Disposable.from(
    controller,
    commandRegistration,
    applyFixCommandRegistration,
    codeActionRegistration,
    saveListener,
    changeListener,
    closeListener,
  );
}
