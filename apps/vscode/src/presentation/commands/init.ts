import {
  createWorkspaceReadme,
  createStoryboardDirectories,
  ensureWorkspaceGitignore,
  writeWorkspaceAgentGuidesIfMissing,
} from '@storyboard/story-engine';
import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import * as vscode from 'vscode';

import type { IStoryboardLogger } from '@storyboard/story-engine';
import { refreshStoryboardWorkspaceContext } from '@/infrastructure/vscode/storyboardWorkspaceContext';
import { getStoryboardProjectPaths, type StoryboardProjectPaths } from '@storyboard/story-model';
import {
  ensureUriDoesNotExist,
  getTargetWorkspaceFolder,
  uriExists,
} from '@/infrastructure/vscode/workspace';
import { createDefaultProjectJson, writeProjectJson } from '@storyboard/story-engine';

const initCommand = 'storyboard.init';

export interface RegisterInitCommandDependencies {
  readonly logger: IStoryboardLogger;
}

export function registerInitCommand(
  dependencies: RegisterInitCommandDependencies,
): vscode.Disposable {
  return vscode.commands.registerCommand(initCommand, () =>
    initializeStoryboardProject(dependencies),
  );
}

async function initializeStoryboardProject(
  dependencies: RegisterInitCommandDependencies,
): Promise<void> {
  const workspaceFolder = await getTargetWorkspaceFolder();

  if (!workspaceFolder) {
    return;
  }

  const paths = getStoryboardProjectPaths(workspaceFolder.uri);

  try {
    if (!(await validateCanInitialize(paths))) {
      return;
    }

    const project = createDefaultProjectJson({ name: workspaceFolder.name });

    await createStoryboardDirectories(vscodeFileSystem, paths);
    await writeProjectJson(vscodeFileSystem, paths.projectJson, project);
    await writeFileIfMissing(paths.sampleCharacterCard, createSampleCharacterCard());
    await writeFileIfMissing(paths.sampleBackgroundCard, createSampleBackgroundCard());
    await writeFileIfMissing(paths.sampleScene, createSampleScene());
    await ensureWorkspaceGitignore(vscodeFileSystem, paths.gitignore);
    await writeFileIfMissing(paths.readme, createWorkspaceReadme(project.name));
    await writeWorkspaceAgentGuidesIfMissing(vscodeFileSystem, paths);

    dependencies.logger.info(`Initialized Storyboard project at ${workspaceFolder.uri.fsPath}`);
    await refreshStoryboardWorkspaceContext();
    await vscode.window.showInformationMessage(
      `Storyboard 프로젝트를 초기화했습니다: ${project.name}`,
    );
  } catch (error) {
    dependencies.logger.error('Failed to initialize Storyboard project', error);
    dependencies.logger.show();
    await vscode.window.showErrorMessage(
      'Storyboard 프로젝트 초기화에 실패했습니다. Output 패널을 확인해 주세요.',
    );
  }
}

async function validateCanInitialize(paths: StoryboardProjectPaths): Promise<boolean> {
  if (await uriExists(paths.projectJson)) {
    await vscode.window.showInformationMessage('이미 Storyboard 프로젝트로 초기화된 폴더입니다.');
    return false;
  }

  return ensureUriDoesNotExist(
    paths.metadataDirectory,
    '`.storyboard` 폴더가 이미 있지만 `project.json`은 없습니다. 안전을 위해 초기화를 중단합니다.',
  );
}

async function writeFileIfMissing(uri: vscode.Uri, content: string): Promise<void> {
  if (await uriExists(uri)) {
    return;
  }

  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
}

function createSampleCharacterCard(): string {
  return `type: character
id: sample
name: 샘플 캐릭터
profile: profile/sample.png
role: main
attributes: {}
tags:
  - 샘플
traits: []
description:
  - Storyboard 프로젝트를 시작하기 위한 샘플 캐릭터입니다.
relations: []
arc: []
recentDialogues: []
`;
}

function createSampleBackgroundCard(): string {
  return `type: location
id: sample
name: 샘플 배경
locationKind: place
characterIds: []
tags:
  - 샘플
description:
  - Storyboard 프로젝트를 시작하기 위한 샘플 배경입니다.
`;
}

function createSampleScene(): string {
  return `type: scene
id: 00-sample
title: 샘플 씬
summary: |-
  Storyboard 프로젝트를 시작하기 위한 샘플 씬 카드입니다.
  실제 작업에 반영할 씬은 \`storyboard.scene.create\` 명령으로 생성해 주세요.
`;
}
