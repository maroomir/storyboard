import type { NovelManager } from '@storyboard/story-app';
import type { SeedScenesResult } from '@storyboard/story-engine';
import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import { sceneCardPath } from '@storyboard/story-model';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';

export interface GenerateSceneSeedsCommandDependencies {
  readonly novel: Pick<NovelManager, 'seedScenes'>;
}

const seedFileExtension: string = '.card';

export class GenerateSceneSeedsCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.sceneGenerateAllSeeds;

  public constructor(private readonly dependencies: GenerateSceneSeedsCommandDependencies) {}

  public async run(): Promise<void> {
    const workspaceRoot: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();

    if (!workspaceRoot) {
      await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
      return;
    }

    const seeding: SeedScenesResult | undefined = await this.seedScenes(workspaceRoot);
    if (seeding === undefined) {
      return;
    }

    await this.reportSeeding(workspaceRoot, seeding);
  }

  private async seedScenes(workspaceRoot: vscode.Uri): Promise<SeedScenesResult | undefined> {
    const firstTry: SeedScenesResult = await this.dependencies.novel.seedScenes({
      workspaceRoot,
      overwrite: false,
    });
    if (firstTry.kind !== 'existing_scenes') {
      return firstTry;
    }

    const overwrite: string = '덮어쓰기';
    const choice: string | undefined = await vscode.window.showWarningMessage(
      `이미 씬이 ${firstTry.existingCount}개 있습니다. 아웃라인에서 만든 시드로 같은 이름의 씬을 덮어쓰며, 다른 씬은 그대로 둡니다. 진행할까요?`,
      { modal: true },
      overwrite,
    );
    if (choice !== overwrite) {
      return undefined;
    }

    return await this.dependencies.novel.seedScenes({ workspaceRoot, overwrite: true });
  }

  private async reportSeeding(workspaceRoot: vscode.Uri, seeding: SeedScenesResult): Promise<void> {
    switch (seeding.kind) {
      case 'missing_outline':
        await vscode.window.showWarningMessage(storyboardMessages.missingOutline);
        return;
      case 'empty_plan':
        await vscode.window.showInformationMessage('아웃라인에 생성할 씬이 없습니다.');
        return;
      case 'existing_scenes':
        return;
      case 'failed':
        await vscode.window.showErrorMessage(seeding.message);
        return;
      case 'seeded':
        await this.openFirstSeed(workspaceRoot, seeding.fileNames);
        await vscode.window.showInformationMessage(
          `씬 시드 ${seeding.fileNames.length}개를 생성했습니다.`,
        );
    }
  }

  private async openFirstSeed(
    workspaceRoot: vscode.Uri,
    fileNames: readonly string[],
  ): Promise<void> {
    const firstFileName: string | undefined = fileNames[0];
    if (firstFileName === undefined) {
      return;
    }

    const stem: string = firstFileName.slice(0, -seedFileExtension.length);
    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(
      sceneCardPath(workspaceRoot, stem) as vscode.Uri,
    );
    await vscode.window.showTextDocument(document);
  }
}
