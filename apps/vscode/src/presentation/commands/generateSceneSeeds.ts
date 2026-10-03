import type { StoryUri, OutlineFileSystem } from '@storyboard/story-model';
import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import * as vscode from 'vscode';

import { getStoryboardProjectPaths } from '@storyboard/story-engine';
import { buildSceneSeeds, type GeneratedSceneSeed } from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot, uriExists } from '@/infrastructure/vscode/workspace';
import {
  ChapterPlanParseError,
  parseSceneFileName,
  readChapterPlanFile,
  resolveScenePrefixDigitCount,
} from '@storyboard/story-model';
import { readProjectJson } from '@storyboard/story-engine';
import type { ConfigBridge } from '@storyboard/story-ai';
import { storyboardMessages } from '@/presentation/notifications/storyboardMessages';

const generateSceneSeedsCommand = 'storyboard.scene.generateAllSeeds';

const outlineFileSystem: OutlineFileSystem = {
  readFile: (uri: StoryUri): PromiseLike<Uint8Array> =>
    vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: StoryUri, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export interface RegisterGenerateSceneSeedsCommandDependencies {
  readonly configBridge: ConfigBridge;
}

export function registerGenerateSceneSeedsCommand({
  configBridge,
}: RegisterGenerateSceneSeedsCommandDependencies): vscode.Disposable {
  return vscode.commands.registerCommand(generateSceneSeedsCommand, () =>
    runGenerateSceneSeeds(configBridge),
  );
}

async function runGenerateSceneSeeds(configBridge: ConfigBridge): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot();

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(storyboardMessages.missingWorkspace);
    return;
  }

  const paths = getStoryboardProjectPaths(workspaceRoot);

  if (!(await uriExists(paths.outlineChapters))) {
    await vscode.window.showWarningMessage(storyboardMessages.missingOutline);
    return;
  }

  const project = await readProjectJson(vscodeFileSystem, paths.projectJson);
  const digitCount = resolveScenePrefixDigitCount(
    project.editor.scenePrefixDigits,
    configBridge.inspectScenePrefixDigits(),
  );

  let seeds: GeneratedSceneSeed[];
  try {
    const plan = await readChapterPlanFile(paths.outlineChapters, outlineFileSystem);
    seeds = buildSceneSeeds(plan, digitCount);
  } catch (error) {
    if (error instanceof ChapterPlanParseError) {
      await vscode.window.showErrorMessage(`chapters.yaml을 읽을 수 없습니다: ${error.message}`);
      return;
    }

    throw error;
  }

  const [firstSeed] = seeds;
  if (!firstSeed) {
    await vscode.window.showInformationMessage('아웃라인에 생성할 씬이 없습니다.');
    return;
  }

  if ((await countExistingSceneFiles(paths.sceneDirectory)) > 0) {
    const overwrite = '덮어쓰기';
    const choice = await vscode.window.showWarningMessage(
      `이미 씬 파일이 있습니다. 아웃라인에서 생성한 시드 ${seeds.length}개를 씁니다. 같은 이름의 파일은 덮어쓰며, 다른 파일은 그대로 둡니다. 진행할까요?`,
      { modal: true },
      overwrite,
    );

    if (choice !== overwrite) {
      return;
    }
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '씬 시드 생성' },
    async (progress) => {
      await vscode.workspace.fs.createDirectory(paths.sceneDirectory);

      for (const [index, seed] of seeds.entries()) {
        progress.report({
          message: `${index + 1}/${seeds.length} ${seed.fileName}`,
          increment: 100 / seeds.length,
        });
        const sceneUri = vscode.Uri.joinPath(paths.sceneDirectory, seed.fileName);
        await vscode.workspace.fs.writeFile(sceneUri, new TextEncoder().encode(seed.content));
      }
    },
  );

  const firstSceneUri = vscode.Uri.joinPath(paths.sceneDirectory, firstSeed.fileName);
  const document = await vscode.workspace.openTextDocument(firstSceneUri);
  await vscode.window.showTextDocument(document);

  await vscode.window.showInformationMessage(`씬 시드 ${seeds.length}개를 생성했습니다.`);
}

async function countExistingSceneFiles(sceneDirectory: vscode.Uri): Promise<number> {
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
