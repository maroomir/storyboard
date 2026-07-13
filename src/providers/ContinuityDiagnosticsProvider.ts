import * as vscode from 'vscode';

import type { AiGateway } from '../application/ai/aiGateway';
import type { StoryboardLogger } from '../infrastructure/vscode/logger';
import {
  getStoryboardProjectPaths,
  isDraftMarkdownFile,
} from '../infrastructure/vscode/pathConventions';
import {
  buildNarrativeContext,
  buildSceneContext,
  formatBibleFactLines,
} from '../domain/sceneContext';
import {
  sceneContextFileSystem,
  sceneContextPaths,
  vscodeFsAdapter,
} from '../infrastructure/vscode/workspaceFsAdapters';
import { createDiagnostic, toRange } from './diagnosticsShared';
import { hasStoryboardProject } from '../infrastructure/vscode/workspace';
import { parseDraft } from '../domain/files/draft';
import { readSceneFile } from '../domain/files/scene';
import type { ContinuityIssue } from '../services/ai/AIService';

const continuityCheckCommand = 'storyboard.draft.continuityCheck';
const continuitySource = 'storyboard-continuity';

export interface RegisterContinuityDiagnosticsProviderDependencies {
  readonly aiGateway: AiGateway;
  readonly logger: StoryboardLogger;
}

export function toContinuityRange(
  document: vscode.TextDocument,
  issue: ContinuityIssue,
): vscode.Range | undefined {
  return toRange(document, issue.start, issue.end);
}

export function mapContinuityIssuesToDiagnostics(
  document: vscode.TextDocument,
  issues: readonly ContinuityIssue[],
): vscode.Diagnostic[] {
  return issues.flatMap((issue) => {
    const range = toContinuityRange(document, issue);
    if (!range) {
      return [];
    }

    const message = `설정 불일치: ${issue.reason}`;
    const severity =
      issue.severity === 'low'
        ? (vscode.DiagnosticSeverity?.Information ?? 2)
        : (vscode.DiagnosticSeverity?.Warning ?? 1);
    return [
      createDiagnostic(range, message, continuitySource, severity as vscode.DiagnosticSeverity),
    ];
  });
}

class ContinuityDiagnosticsController {
  private readonly collection = vscode.languages.createDiagnosticCollection(continuitySource);
  public constructor(
    private readonly dependencies: RegisterContinuityDiagnosticsProviderDependencies,
  ) {}

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

    const paths = getStoryboardProjectPaths(workspaceFolder.uri);
    const sceneStem = resolveSceneStem(document);
    const sceneFileName = `${sceneStem}.txt`;

    let factLines: string[];
    try {
      const scene = await readSceneFile(
        vscode.Uri.joinPath(paths.sceneDirectory, sceneFileName),
        vscodeFsAdapter,
        sceneFileName,
      );
      const ctxPaths = sceneContextPaths(paths);
      const context = await buildSceneContext(ctxPaths, scene, sceneContextFileSystem);
      const narrative = await buildNarrativeContext(ctxPaths, context, sceneContextFileSystem);
      factLines = formatBibleFactLines(context, narrative.bibleFacts);
    } catch (error) {
      this.dependencies.logger.error('Continuity context build failed', error);
      this.collection.delete(document.uri);
      return;
    }

    if (factLines.length === 0) {
      this.collection.delete(document.uri);
      return;
    }

    try {
      const issues = await this.dependencies.aiGateway
        .createService(workspaceFolder.uri)
        .checkContinuity(document.getText(), factLines, {
          providerId: this.dependencies.aiGateway.getTaskProvider('continuityCheck'),
          attribution: { primary: { kind: 'scene', id: sceneStem } },
        });
      this.collection.set(document.uri, mapContinuityIssuesToDiagnostics(document, issues));
    } catch (error) {
      this.dependencies.logger.error('Continuity check failed', error);
      this.collection.delete(document.uri);
    }
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
}

function resolveSceneStem(document: vscode.TextDocument): string {
  try {
    return parseDraft(document.getText()).sceneStem;
  } catch {
    const fileName = document.uri.path.split('/').pop() ?? '';
    return fileName.replace(/\.md$/i, '');
  }
}

async function runContinuityCheckCommand(
  controller: ContinuityDiagnosticsController,
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

export function registerContinuityDiagnosticsProvider(
  dependencies: RegisterContinuityDiagnosticsProviderDependencies,
): vscode.Disposable {
  const controller = new ContinuityDiagnosticsController(dependencies);

  const commandRegistration = vscode.commands.registerCommand(
    continuityCheckCommand,
    (uri?: vscode.Uri) => runContinuityCheckCommand(controller, uri),
  );
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    controller.getDiagnosticsCollection().delete(document.uri);
  });

  return vscode.Disposable.from(controller, commandRegistration, closeListener);
}
