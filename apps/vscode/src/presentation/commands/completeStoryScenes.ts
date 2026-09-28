import * as vscode from 'vscode';

import type { CompleteStoryScenesUseCase } from '@storyboard/story-engine';
import { parseScene } from '@storyboard/story-format';
import type { ProposalReviewService } from '@/presentation/providers/proposalReviewService';

const completeStoryCommand = 'storyboard.scene.completeStory';

export function registerCompleteStoryScenesCommand(
  context: vscode.ExtensionContext,
  useCase: CompleteStoryScenesUseCase,
  reviewService: ProposalReviewService,
): vscode.Disposable {
  return vscode.commands.registerCommand(completeStoryCommand, async (): Promise<void> => {
    const workspaceRoot = resolveWorkspaceRoot();
    if (!workspaceRoot) {
      await vscode.window.showErrorMessage('Storyboard 프로젝트 작업 공간을 열어주세요.');
      return;
    }

    try {
      const proposal = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '이야기 완결 씬 제안 생성 중...',
          cancellable: true,
        },
        async (_progress, token) => {
          const result = await useCase.execute({ workspaceRoot });
          if (token.isCancellationRequested) {
            throw new StoryCompletionCancelledError();
          }
          return result;
        },
      );
      const selectedCount = await choosePrefix(proposal.scenes.length);
      if (!selectedCount) {
        return;
      }
      const selected = proposal.scenes.slice(0, selectedCount);
      await reviewService.showDiffs(
        selected.map((scene) => ({
          original: undefined,
          proposedText: scene.content,
          key: `complete-${scene.fileName}`,
          label: `${scene.fileName} ↔ 새 완결 씬`,
        })),
      );
      const review = [
        proposal.centralQuestion ? `중심 질문: ${proposal.centralQuestion}` : undefined,
        proposal.climaxChoice ? `클라이맥스 선택: ${proposal.climaxChoice}` : undefined,
        ...selected.flatMap((scene) => [
          scene.resolvedThreads.length > 0
            ? `${scene.fileName} 회수: ${scene.resolvedThreads.join(', ')}`
            : undefined,
          scene.openThreads.length > 0
            ? `${scene.fileName} 열린 복선: ${scene.openThreads.join(', ')}`
            : undefined,
        ]),
      ].filter((line): line is string => line !== undefined);
      const confirmation = await vscode.window.showWarningMessage(
        `새 씬 ${selected.length}개를 추가합니다. 기존 씬은 변경하지 않습니다.${review.length > 0 ? `\n${review.join('\n')}` : ''}`,
        { modal: true },
        '적용',
      );
      if (confirmation !== '적용') {
        return;
      }
      if (!(await useCase.hasCurrentSources(proposal.snapshots))) {
        await vscode.window.showWarningMessage(
          '검토 중 소스가 변경되었습니다. Regenerate로 다시 제안해주세요.',
        );
        return;
      }

      const edit = new vscode.WorkspaceEdit();
      for (const scene of selected) {
        const uri = vscode.Uri.joinPath(workspaceRoot, 'scene', scene.fileName);
        edit.createFile(uri, { overwrite: false, ignoreIfExists: false });
        edit.insert(uri, new vscode.Position(0, 0), scene.content);
      }
      if (!(await vscode.workspace.applyEdit(edit))) {
        await vscode.window.showErrorMessage(
          '완결 씬을 적용하지 못했습니다. 파일은 변경되지 않았을 수 있습니다.',
        );
        return;
      }
      for (const scene of selected) {
        const uri = vscode.Uri.joinPath(workspaceRoot, 'scene', scene.fileName);
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        parseScene(text, scene.fileName);
      }
      await vscode.window.showInformationMessage(`완결 씬 ${selected.length}개를 추가했습니다.`);
    } catch (error) {
      if (error instanceof StoryCompletionCancelledError) {
        return;
      }
      await vscode.window.showErrorMessage(
        `이야기 완결 제안을 만들지 못했습니다: ${messageOf(error)}`,
      );
    }
  });
}

async function choosePrefix(count: number): Promise<number | undefined> {
  const choices = Array.from({ length: count }, (_, index) => ({
    label: `${index + 1}개 적용`,
    description: index === 0 ? '첫 완결 씬만 적용' : `첫 ${index + 1}개 씬을 연속으로 적용`,
    value: index + 1,
  }));
  return (
    await vscode.window.showQuickPick(choices, {
      title: '적용할 완결 씬 범위',
      placeHolder: '연속된 앞부분만 적용할 수 있습니다.',
    })
  )?.value;
}

function resolveWorkspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class StoryCompletionCancelledError extends Error {}
