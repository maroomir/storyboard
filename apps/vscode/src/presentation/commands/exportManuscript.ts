import * as vscode from 'vscode';

import type { ManuscriptManager } from '@storyboard/story-app';
import type {
  ExportManuscriptResult,
  IStoryboardLogger,
  LoadExportSourceResult,
} from '@storyboard/story-engine';
import type { ManuscriptExportFormat } from '@storyboard/story-model';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';

const exportManuscriptCommand: string = 'storyboard.draft.export';

interface ExportFormatItem extends vscode.QuickPickItem {
  readonly format: ManuscriptExportFormat;
  readonly extension: string;
}

const exportFormatItems: ExportFormatItem[] = [
  { label: 'Markdown (.md)', format: 'md', extension: 'md' },
  { label: 'Plain text (.txt)', format: 'txt', extension: 'txt' },
];

export interface RegisterExportManuscriptCommandDependencies {
  readonly manuscript: Pick<ManuscriptManager, 'loadExportSource' | 'writeExport'>;
  readonly logger: IStoryboardLogger;
}

export function registerExportManuscriptCommand(
  dependencies: RegisterExportManuscriptCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(exportManuscriptCommand, () =>
    runExportManuscript(dependencies),
  );
}

async function runExportManuscript(
  dependencies: RegisterExportManuscriptCommandDependencies,
): Promise<void> {
  const workspaceRoot: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
    return;
  }

  const source: LoadExportSourceResult =
    await dependencies.manuscript.loadExportSource(workspaceRoot);

  if (source.kind === 'missing_volume') {
    await vscode.window.showInformationMessage(
      '내보낼 원고가 없습니다. 먼저 Assemble Manuscript를 실행해 주세요.',
    );
    return;
  }
  if (source.kind === 'failed') {
    await reportFailure(source.message, dependencies.logger);
    return;
  }

  const picked: ExportFormatItem | undefined = await vscode.window.showQuickPick(
    exportFormatItems,
    {
      placeHolder: '내보낼 형식을 선택하세요.',
    },
  );
  if (!picked) {
    return;
  }

  const targetUri: vscode.Uri | undefined = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(workspaceRoot, `${source.projectName}.${picked.extension}`),
    filters: { [picked.label]: [picked.extension] },
  });
  if (!targetUri) {
    return;
  }

  const manuscriptExport: ExportManuscriptResult = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '원고 내보내는 중…' },
    () => dependencies.manuscript.writeExport(targetUri, source.markdown, picked.format),
  );
  if (!manuscriptExport.ok) {
    await reportFailure(manuscriptExport.message, dependencies.logger);
    return;
  }

  const document: vscode.TextDocument = await vscode.workspace.openTextDocument(
    manuscriptExport.targetUri,
  );
  await vscode.window.showTextDocument(document);
  await vscode.window.showInformationMessage(
    `원고를 내보냈습니다: ${manuscriptExport.targetUri.fsPath}`,
  );
}

async function reportFailure(message: string, logger: IStoryboardLogger): Promise<void> {
  logger.error('Manuscript export failed', new Error(message));
  logger.show();
  await vscode.window.showErrorMessage(`원고 내보내기에 실패했습니다: ${message}`);
}
