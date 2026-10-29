import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { GenerateOutlineResult } from '@storyboard/story-engine';
import type { NovelManager } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { contractFieldLabels } from '@storyboard/story-model';
import { showStoryboardFailure } from '@/presentation/notifications/showStoryboardFailure';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';

export type GenerateOutlineCommandDependencies = {
  readonly novel: Pick<NovelManager, 'generateOutline'>;
  readonly logger: IStoryboardLogger;
};

export class GenerateOutlineCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.outlineGenerate;

  public constructor(private readonly dependencies: GenerateOutlineCommandDependencies) {}

  public async run(): Promise<void> {
    const workspaceRoot: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();

    if (!workspaceRoot) {
      await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
      return;
    }

    let outlineGeneration: GenerateOutlineResult = await this.generateWithProgress(
      workspaceRoot,
      false,
    );

    if (!outlineGeneration.ok && outlineGeneration.kind === 'existing') {
      const overwrite: '덮어쓰기' | undefined = await vscode.window.showWarningMessage(
        '이미 아웃라인 파일이 있습니다. 덮어쓸까요?',
        { modal: true },
        '덮어쓰기',
      );

      if (overwrite !== '덮어쓰기') {
        return;
      }

      outlineGeneration = await this.generateWithProgress(workspaceRoot, true);
    }

    await this.reportResult(outlineGeneration);
  }

  private async generateWithProgress(
    workspaceRoot: vscode.Uri,
    overwrite: boolean,
  ): Promise<GenerateOutlineResult> {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Storyboard 아웃라인 생성',
        cancellable: false,
      },
      async (progress) =>
        await this.dependencies.novel.generateOutline({
          workspaceRoot,
          overwrite,
          onProgress: (message) => progress.report({ message }),
        }),
    );
  }

  private async reportResult(outlineGeneration: GenerateOutlineResult): Promise<void> {
    if (outlineGeneration.ok) {
      const document: vscode.TextDocument = await vscode.workspace.openTextDocument(
        outlineGeneration.synopsisUri,
      );
      await vscode.window.showTextDocument(document);
      await vscode.window.showInformationMessage(
        '아웃라인을 생성했습니다 (synopsis.md, chapters.yaml).',
      );
      return;
    }

    if (outlineGeneration.kind === 'missing_contract') {
      const openSettings: string = '설정 열기';
      const labels: string = outlineGeneration.missing
        .map((key) => contractFieldLabels[key])
        .join(', ');
      const choice: string | undefined = await vscode.window.showWarningMessage(
        `생성 계약에 필요한 항목이 비어 있습니다: ${labels}. 설정에서 채운 뒤 다시 시도해 주세요.`,
        openSettings,
      );
      if (choice === openSettings) {
        await vscode.commands.executeCommand(storyboardCommandIds.settingsOpen);
      }
      return;
    }

    if (outlineGeneration.kind === 'failed') {
      this.dependencies.logger.error(
        'Outline generation failed',
        new Error(outlineGeneration.message),
      );
      this.dependencies.logger.show();
      await showStoryboardFailure(`아웃라인 생성에 실패했습니다: ${outlineGeneration.message}`);
    }
  }
}
