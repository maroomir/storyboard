import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import { ProjectRepository } from '@storyboard/story-engine';
import type {
  StoryUri,
  ReadWriteFileSystem,
  StoryboardProjectPaths,
  StoryboardProject,
  ChapterPlan,
} from '@storyboard/story-model';
import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import * as vscode from 'vscode';

import {
  getStoryboardProjectPaths,
  buildSceneSeeds,
  type GeneratedSceneSeed,
  ChapterPlanParseError,
  parseSceneFileName,
  readChapterPlanFile,
  resolveScenePrefixDigitCount,
} from '@storyboard/story-model';
import { resolveStoryboardWorkspaceRoot, uriExists } from '@/infrastructure/vscode/workspace';
import type { ConfigBridge } from '@storyboard/story-ai';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';

const outlineFileSystem: ReadWriteFileSystem = {
  readFile: (uri: StoryUri): PromiseLike<Uint8Array> =>
    vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: StoryUri, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export interface GenerateSceneSeedsCommandDependencies {
  readonly configBridge: ConfigBridge;
}

export class GenerateSceneSeedsCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.sceneGenerateAllSeeds;

  public constructor(private readonly dependencies: GenerateSceneSeedsCommandDependencies) {}

  public async run(): Promise<void> {
    const workspaceRoot: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();

    if (!workspaceRoot) {
      await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
      return;
    }

    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);

    if (!(await uriExists(paths.outlineChapters))) {
      await vscode.window.showWarningMessage(storyboardMessages.missingOutline);
      return;
    }

    const seeds: GeneratedSceneSeed[] | undefined = await this.loadSceneSeeds(paths);
    if (!seeds) {
      return;
    }

    const [firstSeed] = seeds;
    if (!firstSeed) {
      await vscode.window.showInformationMessage('아웃라인에 생성할 씬이 없습니다.');
      return;
    }

    if (!(await this.confirmSeedOverwrite(paths.sceneDirectory, seeds.length))) {
      return;
    }

    await writeSceneSeeds(paths.sceneDirectory, seeds);

    const firstSceneUri: vscode.Uri = vscode.Uri.joinPath(paths.sceneDirectory, firstSeed.fileName);
    const document: vscode.TextDocument = await vscode.workspace.openTextDocument(firstSceneUri);
    await vscode.window.showTextDocument(document);

    await vscode.window.showInformationMessage(`씬 시드 ${seeds.length}개를 생성했습니다.`);
  }

  private async loadSceneSeeds(
    paths: StoryboardProjectPaths,
  ): Promise<GeneratedSceneSeed[] | undefined> {
    const project: StoryboardProject = await new ProjectRepository(vscodeFileSystem).read(
      paths.projectJson,
    );
    const digitCount: number = resolveScenePrefixDigitCount(
      project.editor.scenePrefixDigits,
      this.dependencies.configBridge.inspectScenePrefixDigits(),
    );

    try {
      const plan: ChapterPlan = await readChapterPlanFile(paths.outlineChapters, outlineFileSystem);
      return buildSceneSeeds(plan, digitCount);
    } catch (error) {
      if (error instanceof ChapterPlanParseError) {
        await vscode.window.showErrorMessage(`chapters.yaml을 읽을 수 없습니다: ${error.message}`);
        return undefined;
      }

      throw error;
    }
  }

  private async confirmSeedOverwrite(
    sceneDirectory: vscode.Uri,
    seedCount: number,
  ): Promise<boolean> {
    if ((await this.countExistingSceneFiles(sceneDirectory)) === 0) {
      return true;
    }

    const overwrite: string = '덮어쓰기';
    const choice: string | undefined = await vscode.window.showWarningMessage(
      `이미 씬 파일이 있습니다. 아웃라인에서 생성한 시드 ${seedCount}개를 씁니다. 같은 이름의 파일은 덮어쓰며, 다른 파일은 그대로 둡니다. 진행할까요?`,
      { modal: true },
      overwrite,
    );

    return choice === overwrite;
  }

  private async countExistingSceneFiles(sceneDirectory: vscode.Uri): Promise<number> {
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(sceneDirectory);
    } catch {
      return 0;
    }

    return entries.filter(
      ([name, fileType]) =>
        fileType === vscode.FileType.File && parseSceneFileName(name) !== undefined,
    ).length;
  }
}

async function writeSceneSeeds(
  sceneDirectory: vscode.Uri,
  seeds: readonly GeneratedSceneSeed[],
): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '씬 시드 생성' },
    async (progress) => {
      await vscode.workspace.fs.createDirectory(sceneDirectory);

      for (const [index, seed] of seeds.entries()) {
        progress.report({
          message: `${index + 1}/${seeds.length} ${seed.fileName}`,
          increment: 100 / seeds.length,
        });
        const sceneUri: vscode.Uri = vscode.Uri.joinPath(sceneDirectory, seed.fileName);
        await vscode.workspace.fs.writeFile(sceneUri, new TextEncoder().encode(seed.content));
      }
    },
  );
}
