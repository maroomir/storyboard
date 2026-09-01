import * as vscode from 'vscode';

import type { ExportManuscriptUseCase } from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import type { ManuscriptExportFormat } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '../../infrastructure/vscode/workspace';

const exportManuscriptCommand = 'storyboard.draft.export';

interface ExportFormatItem extends vscode.QuickPickItem {
  readonly format: ManuscriptExportFormat;
  readonly extension: string;
}

const exportFormatItems: ExportFormatItem[] = [
  { label: 'Markdown (.md)', format: 'md', extension: 'md' },
  { label: 'Plain text (.txt)', format: 'txt', extension: 'txt' },
];

export interface RegisterExportManuscriptCommandDependencies {
  readonly exportManuscriptUseCase: ExportManuscriptUseCase;
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
  const workspaceRoot = await resolveStoryboardWorkspaceRoot();

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
    );
    return;
  }

  const source = await dependencies.exportManuscriptUseCase.loadSource(workspaceRoot);

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

  const picked = await vscode.window.showQuickPick(exportFormatItems, {
    placeHolder: '내보낼 형식을 선택하세요.',
  });
  if (!picked) {
    return;
  }

  const targetUri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(workspaceRoot, `${source.projectName}.${picked.extension}`),
    filters: { [picked.label]: [picked.extension] },
  });
  if (!targetUri) {
    return;
  }

  const result = await dependencies.exportManuscriptUseCase.writeExport(
    targetUri,
    source.markdown,
    picked.format,
  );
  if (!result.ok) {
    await reportFailure(result.message, dependencies.logger);
    return;
  }

  const document = await vscode.workspace.openTextDocument(result.targetUri);
  await vscode.window.showTextDocument(document);
  await vscode.window.showInformationMessage(`원고를 내보냈습니다: ${result.targetUri.fsPath}`);
}

async function reportFailure(message: string, logger: IStoryboardLogger): Promise<void> {
  logger.error('Manuscript export failed', new Error(message));
  logger.show();
  await vscode.window.showErrorMessage(`원고 내보내기에 실패했습니다: ${message}`);
}
