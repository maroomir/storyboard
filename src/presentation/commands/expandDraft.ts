import * as vscode from 'vscode';

import type { AiGateway } from '../../application/ai/aiGateway';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { isDraftMarkdownFile } from '../../infrastructure/vscode/pathConventions';
import { hasStoryboardProject } from '../../infrastructure/vscode/workspace';
import { parseDraft } from '../../domain/files/draft';

const expandDraftCommand = 'storyboard.draft.expand';

export interface RegisterExpandDraftCommandDependencies {
  readonly aiGateway: AiGateway;
  readonly logger: StoryboardLogger;
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

async function runExpandDraftCommand(
  dependencies: RegisterExpandDraftCommandDependencies,
  invokedUri?: vscode.Uri,
  rangeArg?: vscode.Range,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor || editor.document.uri.scheme !== 'file') {
    await vscode.window.showErrorMessage('활성 드래프트 파일을 열고 다시 시도해 주세요.');
    return;
  }

  if (invokedUri && editor.document.uri.toString() !== invokedUri.toString()) {
    await vscode.window.showErrorMessage(
      '현재 활성화된 드래프트 파일에서만 확장을 실행할 수 있습니다.',
    );
    return;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);

  if (!workspaceFolder) {
    await vscode.window.showErrorMessage('워크스페이스 폴더를 찾을 수 없습니다.');
    return;
  }

  if (!(await hasStoryboardProject(workspaceFolder))) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다.',
    );
    return;
  }

  if (!isDraftMarkdownFile(editor.document.uri, workspaceFolder)) {
    await vscode.window.showErrorMessage('`draft/*.md` 파일에서만 확장할 수 있습니다.');
    return;
  }

  const targetRange = resolveExpandRange(editor, rangeArg);

  if (targetRange.isEmpty) {
    await vscode.window.showInformationMessage('확장할 텍스트를 먼저 선택해 주세요.');
    return;
  }

  const selectedText = editor.document.getText(targetRange).trim();

  if (selectedText.length === 0) {
    await vscode.window.showInformationMessage('빈 선택 영역은 확장할 수 없습니다.');
    return;
  }

  let sceneStem = 'unknown-scene';

  try {
    const parsed = parseDraft(editor.document.getText());
    sceneStem = parsed.sceneStem;
  } catch {
    const fallbackName = editor.document.uri.path.split('/').pop() ?? '';
    sceneStem = fallbackName.replace(/\.md$/i, '');
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Storyboard 선택 영역 확장',
        cancellable: false,
      },
      async () => {
        const expanded = await dependencies.aiGateway
          .createService(workspaceFolder.uri)
          .expandDraft(
            selectedText,
            {},
            {
              providerId: dependencies.aiGateway.getTaskProvider('draftExpansion'),
              attribution: { primary: { kind: 'scene', id: sceneStem } },
            },
          );

        if (!expanded) {
          await vscode.window.showWarningMessage('확장 결과가 비어 있어 적용하지 않았습니다.');
          return;
        }

        await editor.edit((editBuilder) => {
          editBuilder.replace(targetRange, expanded);
        });
      },
    );
  } catch (error) {
    dependencies.logger.error('Expand draft failed', error);
    dependencies.logger.show();
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`선택 영역 확장에 실패했습니다: ${message}`);
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
