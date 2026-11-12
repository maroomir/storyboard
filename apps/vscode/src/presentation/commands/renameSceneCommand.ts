import { storyboardCommandIds } from '@/contributionIds';
import type { IExtensionCommand } from '@/presentation/commands/extensionCommand';
import * as vscode from 'vscode';

import type { DraftManager, RunGate } from '@storyboard/story-app';
import {
  getStoryboardProjectPaths,
  sceneCardPath,
  parseSceneFileName,
  isSceneSlug,
  parseSceneStem,
} from '@storyboard/story-model';
import {
  hasStoryboardProject,
  resolveStoryboardWorkspaceRoot,
  uriExists,
} from '@/infrastructure/vscode/workspace';
import { runHoldingWorkspaceLock } from '@/presentation/commands/workspaceRunLock';
import {
  resolveSceneBundleTarget,
  resolveSceneUriFromInvocation,
} from '@/presentation/commands/sceneInvocation';
import { cardEditorViewType } from '@/contributionIds';
import type { RenameSceneResult } from '@storyboard/story-engine';

export interface RenameSceneCommandDependencies {
  readonly drafts: Pick<DraftManager, 'renameScene'>;
  readonly runGate: Pick<RunGate, 'hold'>;
}

export class RenameSceneCommand implements IExtensionCommand {
  public readonly id: string = storyboardCommandIds.sceneRename;

  public constructor(private readonly dependencies: RenameSceneCommandDependencies) {}

  public async run(invokedUri?: vscode.Uri): Promise<void> {
    const target: TargetScene | undefined = await this.resolveTargetScene(invokedUri);

    if (!target) {
      return;
    }

    const currentSlug: string = parseSceneStem(target.fromStem)?.slug ?? target.fromStem;
    const toSlug: string | undefined = await askForNewSceneSlug(currentSlug);

    if (!toSlug || toSlug.trim() === currentSlug) {
      return;
    }

    await runHoldingWorkspaceLock(
      this.dependencies.runGate,
      target.workspaceRoot,
      '씬 이름 변경',
      () => this.renameScene(target, toSlug.trim()),
    );
  }

  private async renameScene(
    { workspaceRoot, fromStem }: TargetScene,
    toSlug: string,
  ): Promise<void> {
    const sceneRename: RenameSceneResult = await this.dependencies.drafts.renameScene({
      workspaceRoot,
      scene: fromStem,
      to: toSlug,
    });

    if (!sceneRename.ok) {
      await vscode.window.showWarningMessage(sceneRename.message);
      return;
    }

    const activeUri: vscode.Uri | undefined = resolveSceneUriFromInvocation();
    const wasOpen: boolean =
      activeUri !== undefined && resolveSceneBundleTarget(activeUri)?.stem === fromStem;

    if (wasOpen) {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        sceneCardPath(workspaceRoot, sceneRename.toStem) as vscode.Uri,
        cardEditorViewType,
      );
    }

    void vscode.window.showInformationMessage(
      `${sceneRename.fromStem} → ${sceneRename.toStem}: 파일 ${sceneRename.movedFiles.length}개를 옮기고 ${sceneRename.rewrittenFiles.length}개를 고쳤습니다.`,
    );
  }

  private async resolveTargetScene(invokedUri?: vscode.Uri): Promise<TargetScene | undefined> {
    const workspaceRoot: vscode.Uri | undefined = invokedUri
      ? vscode.workspace.getWorkspaceFolder(invokedUri)?.uri
      : await resolveStoryboardWorkspaceRoot();
    const workspaceFolder: vscode.WorkspaceFolder | undefined =
      workspaceRoot && vscode.workspace.getWorkspaceFolder(workspaceRoot);

    if (!workspaceRoot || !workspaceFolder || !(await hasStoryboardProject(workspaceFolder))) {
      await vscode.window.showWarningMessage('Storyboard 프로젝트가 아닙니다.');
      return undefined;
    }

    const candidateUri: vscode.Uri | undefined = resolveSceneUriFromInvocation(invokedUri);
    const candidateStem: string | undefined =
      candidateUri === undefined ? undefined : resolveSceneBundleTarget(candidateUri)?.stem;

    if (candidateStem) {
      return { workspaceRoot, fromStem: candidateStem };
    }

    if (invokedUri) {
      await vscode.window.showErrorMessage(
        '`scene` 폴더의 `NNN-slug.card` 씬만 이름을 바꿀 수 있습니다.',
      );
      return undefined;
    }

    const stems: string[] = await this.listSceneStems(workspaceRoot);
    const picked: string | undefined = await vscode.window.showQuickPick(stems, {
      title: '씬 이름 변경',
      placeHolder: '이름을 바꿀 씬을 고르세요',
    });

    return picked ? { workspaceRoot, fromStem: picked } : undefined;
  }

  private async listSceneStems(workspaceRoot: vscode.Uri): Promise<string[]> {
    const sceneDirectory: vscode.Uri = getStoryboardProjectPaths(workspaceRoot)
      .sceneDirectory as vscode.Uri;

    if (!(await uriExists(sceneDirectory))) {
      return [];
    }

    const entries: [string, vscode.FileType][] =
      await vscode.workspace.fs.readDirectory(sceneDirectory);

    return entries
      .flatMap(([fileName]) => parseSceneFileName(fileName) ?? [])
      .sort((left, right) => left.order - right.order)
      .map((parts) => parts.stem);
  }
}

interface TargetScene {
  readonly workspaceRoot: vscode.Uri;
  readonly fromStem: string;
}

const sceneSlugInputPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

function validateSceneSlugInput(value: string): string | undefined {
  const slug: string = value.trim();
  const isSlug: boolean = sceneSlugInputPattern.test(slug) && isSceneSlug(slug);
  return isSlug
    ? undefined
    : '`moon-market` 처럼 영문 소문자·숫자·하이픈이어야 합니다(번호는 붙이지 않음).';
}

async function askForNewSceneSlug(currentSlug: string): Promise<string | undefined> {
  return await vscode.window.showInputBox({
    title: '씬 이름 변경',
    prompt:
      '새 slug 를 입력하세요. 번호는 엔진이 그대로 붙이고, 번호 붙은 폴더와 초안 이름이 함께 바뀝니다.',
    value: currentSlug,
    ignoreFocusOut: true,
    validateInput: validateSceneSlugInput,
  });
}
