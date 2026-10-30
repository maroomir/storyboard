import * as vscode from 'vscode';
import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import {
  buildCondenseReviewLabels,
  CONDENSE_PREVIEW_SCHEME,
  type CondenseReviewLabels,
} from '@/presentation/commands/condenseDraft';

import type { CondenseDraftResult } from '@storyboard/story-engine';
import type { DraftManager } from '@storyboard/story-app';
import {
  createDraft,
  parseDraft,
  serializeDraft,
  isDraftMarkdownFile,
} from '@storyboard/story-model';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { hasStoryboardProject } from '@/infrastructure/vscode/workspace';
import { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';

export interface CondenseDraftCommandDependencies {
  readonly drafts: Pick<DraftManager, 'condense' | 'archiveDraftWhenHistoryIsKept'>;
  readonly logger: IStoryboardLogger;
}

interface CondenseTarget {
  readonly editor: vscode.TextEditor;
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly documentText: string;
  readonly draft: ReturnType<typeof parseDraft>;
}

export class CondenseDraftCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.draftCondense;

  public constructor(
    private readonly dependencies: CondenseDraftCommandDependencies,
    private readonly previewProvider: VirtualDocumentStore,
  ) {}

  public async run(invokedUri?: vscode.Uri): Promise<void> {
    const target: CondenseTarget | undefined = await this.resolveCondenseTarget(invokedUri);
    if (!target || target.draft.body.trim().length === 0) {
      return;
    }

    const condensation: CondenseDraftResult = await this.condenseDraft(target);

    if (!condensation.ok) {
      await this.reportFailure(condensation);
      return;
    }

    const labels: CondenseReviewLabels = buildCondenseReviewLabels(condensation);
    const proposed: string = serializeDraft(
      createDraft({
        sceneStem: target.draft.sceneStem,
        format: target.draft.format,
        body: condensation.text,
        generator: target.draft.generator,
        providerId: target.draft.providerId,
        model: target.draft.model,
      }),
    );
    if (!(await this.confirmCondensation(target, proposed, labels))) {
      return;
    }

    await this.applyCondensation(target, proposed);
  }

  private async condenseDraft(target: CondenseTarget): Promise<CondenseDraftResult> {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Storyboard 원본 축소',
        cancellable: false,
      },
      async () =>
        await this.dependencies.drafts.condense({
          workspaceRoot: target.workspaceFolder.uri,
          sceneStem: target.draft.sceneStem,
          format: target.draft.format,
          body: target.draft.body,
        }),
    );
  }

  private async confirmCondensation(
    target: CondenseTarget,
    proposed: string,
    labels: CondenseReviewLabels,
  ): Promise<boolean> {
    await this.showCondenseDiff(
      target.editor.document.uri,
      target.documentText,
      proposed,
      labels.diffTitle,
    );

    const decision: string | undefined = await vscode.window.showInformationMessage(
      labels.confirmPrompt,
      '적용',
      labels.cancelLabel,
    );
    return decision === '적용';
  }

  private async applyCondensation(target: CondenseTarget, proposed: string): Promise<void> {
    await this.archiveDraftBeforeApply(target);
    const fullRange: vscode.Range = new vscode.Range(
      target.editor.document.positionAt(0),
      target.editor.document.positionAt(target.documentText.length),
    );
    const edit: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();
    edit.replace(target.editor.document.uri, fullRange, proposed);
    const applied: boolean = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      await vscode.window.showErrorMessage('축소 결과를 적용하지 못했습니다.');
      return;
    }

    await target.editor.document.save();
    await vscode.window.showInformationMessage('원본 축소를 적용했습니다.');
  }

  private async resolveCondenseTarget(
    invokedUri?: vscode.Uri,
  ): Promise<CondenseTarget | undefined> {
    const editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;

    if (!editor || editor.document.uri.scheme !== 'file') {
      await vscode.window.showErrorMessage('활성 드래프트 파일을 열고 다시 시도해 주세요.');
      return undefined;
    }
    if (invokedUri && editor.document.uri.toString() !== invokedUri.toString()) {
      await vscode.window.showErrorMessage(
        '현재 활성화된 드래프트 파일에서만 원본 축소를 실행할 수 있습니다.',
      );
      return undefined;
    }

    const workspaceFolder: vscode.WorkspaceFolder | undefined = vscode.workspace.getWorkspaceFolder(
      editor.document.uri,
    );
    if (!workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
      await vscode.window.showErrorMessage(
        'Storyboard 프로젝트의 드래프트 파일에서만 원본 축소를 실행할 수 있습니다.',
      );
      return undefined;
    }
    if (!isDraftMarkdownFile(editor.document.uri, workspaceFolder)) {
      await vscode.window.showErrorMessage(
        '`draft/*.md` 파일에서만 원본 축소를 실행할 수 있습니다.',
      );
      return undefined;
    }

    try {
      return {
        editor,
        workspaceFolder,
        documentText: editor.document.getText(),
        draft: parseDraft(editor.document.getText()),
      };
    } catch {
      await vscode.window.showErrorMessage(
        '드래프트 형식을 해석할 수 없습니다. frontmatter를 확인해 주세요.',
      );
      return undefined;
    }
  }

  private async showCondenseDiff(
    draftUri: vscode.Uri,
    before: string,
    after: string,
    title: string,
  ): Promise<void> {
    const beforeUri: vscode.Uri = previewUri(draftUri, 'before');
    const afterUri: vscode.Uri = previewUri(draftUri, 'after');
    this.previewProvider.setContent(beforeUri, before);
    this.previewProvider.setContent(afterUri, after);
    await vscode.commands.executeCommand('vscode.diff', beforeUri, afterUri, title, {
      preview: true,
    });
  }

  private async archiveDraftBeforeApply(target: CondenseTarget): Promise<void> {
    try {
      await this.dependencies.drafts.archiveDraftWhenHistoryIsKept(
        target.workspaceFolder.uri,
        target.draft.sceneStem,
      );
    } catch (error) {
      this.dependencies.logger.warn(
        `이전 초안을 .draft 히스토리에 보관하지 못했습니다: ${String(error)}`,
      );
    }
  }

  private async reportFailure(
    failure: Exclude<CondenseDraftResult, { readonly ok: true }>,
  ): Promise<void> {
    if (failure.kind === 'rejected') {
      const reason: string =
        failure.reason === 'not-shorter'
          ? '축소되지 않았습니다.'
          : failure.reason === 'too-short'
            ? `너무 짧습니다 (${failure.candidateLength}자 / 최소 ${failure.minimumLength}자).`
            : failure.reason === 'scene-breaks-changed'
              ? '장면 구분(---)의 수가 바뀌었습니다.'
              : '본문으로 적용할 수 없는 응답입니다.';
      await vscode.window.showWarningMessage(`원본을 유지했습니다: ${reason}`);
      return;
    }

    await showStoryboardFailure(`원본 축소에 실패했습니다: ${failure.message}`);
  }
}

function previewUri(draftUri: vscode.Uri, version: 'before' | 'after'): vscode.Uri {
  const baseName: string = (draftUri.path.split('/').at(-1) ?? 'draft.md').replace(/\.md$/, '');
  return vscode.Uri.from({
    scheme: CONDENSE_PREVIEW_SCHEME,
    path: `/${baseName}-${version}.md`,
    query: draftUri.toString(),
  });
}
