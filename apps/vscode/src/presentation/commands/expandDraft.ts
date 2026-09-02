import * as vscode from 'vscode';

import type { ExpandDraftResult, ExpandDraftUseCase } from '@storyboard/story-engine';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { isDraftMarkdownFile } from '@storyboard/story-engine';
import { hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import { parseDraft } from '@storyboard/story-format';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';

const expandDraftCommand = 'storyboard.draft.expand';

export interface RegisterExpandDraftCommandDependencies {
  readonly expandDraftUseCase: ExpandDraftUseCase;
  readonly logger: IStoryboardLogger;
}

export function resolveExpandRange(
  editor: vscode.TextEditor,
  rangeArg?: vscode.Range,
): vscode.Selection | vscode.Range {
  if (rangeArg && !rangeArg.isEmpty) {
    return rangeArg;
  }

  return editor.selection;
}

interface ExpandTarget {
  readonly editor: vscode.TextEditor;
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly targetRange: vscode.Selection | vscode.Range;
  readonly selectedText: string;
  readonly sceneStem: string;
}

function resolveSceneStem(editor: vscode.TextEditor): string {
  try {
    return parseDraft(editor.document.getText()).sceneStem;
  } catch {
    const fallbackName = editor.document.uri.path.split('/').pop() ?? '';
    return fallbackName.replace(/\.md$/i, '');
  }
}

async function resolveExpandTarget(
  invokedUri?: vscode.Uri,
  rangeArg?: vscode.Range,
): Promise<ExpandTarget | undefined> {
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.uri.scheme !== 'file') {
    await vscode.window.showErrorMessage('활성 드래프트 파일을 열고 다시 시도해 주세요.');
    return undefined;
  }

  if (invokedUri && editor.document.uri.toString() !== invokedUri.toString()) {
    await vscode.window.showErrorMessage(
      '현재 활성화된 드래프트 파일에서만 확장을 실행할 수 있습니다.',
    );
    return undefined;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);

  if (!workspaceFolder) {
    await vscode.window.showErrorMessage('워크스페이스 폴더를 찾을 수 없습니다.');
    return undefined;
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다.',
    );
    return undefined;
  }

  if (!isDraftMarkdownFile(editor.document.uri, workspaceFolder)) {
    await vscode.window.showErrorMessage('`draft/*.md` 파일에서만 확장할 수 있습니다.');
    return undefined;
  }

  const targetRange = resolveExpandRange(editor, rangeArg);

  if (targetRange.isEmpty) {
    await vscode.window.showInformationMessage('확장할 텍스트를 먼저 선택해 주세요.');
    return undefined;
  }

  const selectedText = editor.document.getText(targetRange).trim();

  if (selectedText.length === 0) {
    await vscode.window.showInformationMessage('빈 선택 영역은 확장할 수 없습니다.');
    return undefined;
  }

  return {
    editor,
    workspaceFolder,
    targetRange,
    selectedText,
    sceneStem: resolveSceneStem(editor),
  };
}

async function reportExpandFailure(
  result: Extract<ExpandDraftResult, { ok: false }>,
  logger: IStoryboardLogger,
): Promise<void> {
  if (result.kind === 'empty') {
    await vscode.window.showWarningMessage('확장 결과가 비어 있어 적용하지 않았습니다.');
    return;
  }

  logger.show();
  await showStoryboardFailure(`선택 영역 확장에 실패했습니다: ${result.message}`);
}

async function runExpandDraftCommand(
  dependencies: RegisterExpandDraftCommandDependencies,
  invokedUri?: vscode.Uri,
  rangeArg?: vscode.Range,
): Promise<void> {
  const target = await resolveExpandTarget(invokedUri, rangeArg);

  if (!target) {
    return;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Storyboard 선택 영역 확장',
        cancellable: false,
      },
      async () => {
        const result = await dependencies.expandDraftUseCase.execute({
          workspaceRoot: target.workspaceFolder.uri,
          selectedText: target.selectedText,
          sceneStem: target.sceneStem,
        });

        if (!result.ok) {
          await reportExpandFailure(result, dependencies.logger);
          return;
        }

        await target.editor.edit((editBuilder) => {
          editBuilder.replace(target.targetRange, result.text);
        });
      },
    );
  } catch (error) {
    dependencies.logger.error('Expand draft failed', error);
    dependencies.logger.show();
    const message = error instanceof Error ? error.message : String(error);
    await showStoryboardFailure(`선택 영역 확장에 실패했습니다: ${message}`);
  }
}

export function registerExpandDraftCommand(
  dependencies: RegisterExpandDraftCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    expandDraftCommand,
    (invokedUri?: vscode.Uri, rangeArg?: vscode.Range) =>
      runExpandDraftCommand(dependencies, invokedUri, rangeArg),
  );
}
