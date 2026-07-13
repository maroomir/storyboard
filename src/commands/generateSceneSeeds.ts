import * as vscode from 'vscode';

import { getStoryboardProjectPaths } from '../core/pathConventions';
import { buildSceneSeeds, type GeneratedSceneSeed } from '../core/sceneSeedFactory';
import { resolveStoryboardWorkspaceRoot, uriExists } from '../core/workspace';
import {
  ChapterPlanParseError,
  readChapterPlanFile,
  type OutlineFileSystem,
} from '../files/outline';
import { readProjectJson } from '../files/projectJson';
import { parseSceneFileName } from '../shared/scene';
import { resolveScenePrefixDigitCount } from '../domain/scenePrefixDigits';

const generateSceneSeedsCommand = 'storyboard.scene.generateAllSeeds';

const outlineFileSystem: OutlineFileSystem = {
  readFile: (uri: unknown): PromiseLike<Uint8Array> =>
    vscode.workspace.fs.readFile(uri as vscode.Uri),
  writeFile: (uri: unknown, content: Uint8Array): PromiseLike<void> =>
    vscode.workspace.fs.writeFile(uri as vscode.Uri, content),
};

export function registerGenerateSceneSeedsCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(generateSceneSeedsCommand, () => runGenerateSceneSeeds());
}

async function runGenerateSceneSeeds(): Promise<void> {
  const workspaceRoot = await resolveStoryboardWorkspaceRoot();

  if (!workspaceRoot) {
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트(.storyboard/project.json)가 없습니다. 먼저 초기화해 주세요.',
    );
    return;
  }

  const paths = getStoryboardProjectPaths(workspaceRoot);

  if (!(await uriExists(paths.outlineChapters))) {
    await vscode.window.showWarningMessage(
      '아웃라인(chapters.yaml)이 없습니다. 먼저 Generate Novel Outline을 실행해 주세요.',
    );
    return;
  }

  const project = await readProjectJson(paths.projectJson);
  const inspected = vscode.workspace
    .getConfiguration('storyboard')
    .inspect<number>('scene.prefixDigits');
  const digitCount = resolveScenePrefixDigitCount(project.editor.scenePrefixDigits, inspected);

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

  await vscode.workspace.fs.createDirectory(paths.sceneDirectory);

  for (const seed of seeds) {
    const sceneUri = vscode.Uri.joinPath(paths.sceneDirectory, seed.fileName);
    await vscode.workspace.fs.writeFile(sceneUri, new TextEncoder().encode(seed.content));
  }

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
