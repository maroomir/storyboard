import * as vscode from 'vscode';

import type { DraftManager } from '@storyboard/story-app';
import type { CheckDraftResult, IStoryboardLogger } from '@storyboard/story-engine';
import type { ConfigBridge } from '@storyboard/story-ai';
import { isDraftMarkdownFile, parseDraft, type SlopFinding } from '@storyboard/story-model';
import { createDiagnostic, createWarningDiagnostic, toRange } from './diagnosticsShared';
import { hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import { LatestRequestGuard } from './latestRequestGuard';

const slopCheckCommand: string = 'storyboard.draft.slopCheck';
const slopSource: string = 'storyboard-slop';
const slopDebounceMs: number = 700;

export interface RegisterSlopDiagnosticsProviderDependencies {
  readonly drafts: Pick<DraftManager, 'check'>;
  readonly configBridge: ConfigBridge;
  readonly logger: IStoryboardLogger;
}

export function computeBodyOffset(documentText: string, body: string): number {
  const normalized: string = documentText.replace(/\r\n/g, '\n');
  if (!normalized.endsWith(body)) {
    return normalized.indexOf(body);
  }
  return normalized.length - body.length;
}

export function toSlopRange(
  document: vscode.TextDocument,
  finding: SlopFinding,
  bodyOffset: number,
): vscode.Range | undefined {
  return toRange(document, finding.start + bodyOffset, finding.end + bodyOffset);
}

export function mapSlopFindingsToDiagnostics(
  document: vscode.TextDocument,
  findings: readonly SlopFinding[],
  bodyOffset: number,
): vscode.Diagnostic[] {
  return findings.flatMap((finding) => {
    const range: vscode.Range | undefined = toSlopRange(document, finding, bodyOffset);
    if (!range) {
      return [];
    }

    const diagnostic: vscode.Diagnostic =
      finding.severity === 'warning'
        ? createWarningDiagnostic(range, finding.message, slopSource)
        : createDiagnostic(
            range,
            finding.message,
            slopSource,
            (vscode.DiagnosticSeverity?.Information ?? 2) as vscode.DiagnosticSeverity,
          );
    return [diagnostic];
  });
}

class SlopDiagnosticsController {
  private readonly collection: vscode.DiagnosticCollection =
    vscode.languages.createDiagnosticCollection(slopSource);
  private readonly latestRequests: LatestRequestGuard = new LatestRequestGuard();

  public constructor(private readonly dependencies: RegisterSlopDiagnosticsProviderDependencies) {}

  public getDiagnosticsCollection(): vscode.DiagnosticCollection {
    return this.collection;
  }

  public async runForDocument(document: vscode.TextDocument): Promise<void> {
    if (!(await this.canRun(document))) {
      this.collection.delete(document.uri);
      return;
    }

    const documentText: string = document.getText();

    let body: string;
    try {
      body = parseDraft(documentText).body;
    } catch (error) {
      this.dependencies.logger.error('Slop check parse failed', error);
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

    const draftCheck: CheckDraftResult = await this.dependencies.drafts.check({
      workspaceRoot: workspaceFolder.uri,
      sceneStem: document.uri.path.split('/').pop()?.replace(/\.md$/i, '') ?? '',
      kind: 'slop',
      text: body,
    });

    if (draftCheck.kind !== 'slop') {
      this.collection.delete(document.uri);
      return;
    }

    const bodyOffset: number = computeBodyOffset(documentText, body);
    this.collection.set(
      document.uri,
      mapSlopFindingsToDiagnostics(document, draftCheck.findings, bodyOffset),
    );
  }

  public scheduleRealtimeCheck(document: vscode.TextDocument): void {
    this.latestRequests.schedule(
      document.uri.toString(),
      slopDebounceMs,
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
}

async function runSlopCheckCommand(
  controller: SlopDiagnosticsController,
  uri?: vscode.Uri,
): Promise<void> {
  const targetUri: vscode.Uri | undefined = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showErrorMessage('활성 드래프트 파일을 찾을 수 없습니다.');
    return;
  }

  const document: vscode.TextDocument = await vscode.workspace.openTextDocument(targetUri);
  await controller.runForDocument(document);
}

export function registerSlopDiagnosticsProvider(
  dependencies: RegisterSlopDiagnosticsProviderDependencies,
): vscode.Disposable {
  const controller: SlopDiagnosticsController = new SlopDiagnosticsController(dependencies);

  const commandRegistration: vscode.Disposable = vscode.commands.registerCommand(
    slopCheckCommand,
    (uri?: vscode.Uri) => runSlopCheckCommand(controller, uri),
  );
  const saveListener: vscode.Disposable = vscode.workspace.onDidSaveTextDocument((document) => {
    if (!dependencies.configBridge.isSlopRealtimeEnabled()) {
      return;
    }

    controller.scheduleRealtimeCheck(document);
  });
  const closeListener: vscode.Disposable = vscode.workspace.onDidCloseTextDocument((document) => {
    controller.cancelRealtimeCheck(document);
    controller.getDiagnosticsCollection().delete(document.uri);
  });

  return vscode.Disposable.from(controller, commandRegistration, saveListener, closeListener);
}
