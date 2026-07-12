import * as vscode from 'vscode';

import type { StoryboardProjectPaths } from '../../core/pathConventions';
import { uriExists } from '../../core/workspace';

const STORYBOARD_GITIGNORE_BLOCK = `
# Storyboard generated files
.storyboard/cache/
draft/
.draft/
manuscript/
character/.sample.card
background/.sample.card
scene/.sample.txt
`;

export async function createStoryboardDirectories(paths: StoryboardProjectPaths): Promise<void> {
  await Promise.all([
    vscode.workspace.fs.createDirectory(paths.sceneCacheDirectory),
    vscode.workspace.fs.createDirectory(paths.characterProfileDirectory),
    vscode.workspace.fs.createDirectory(paths.backgroundDirectory),
    vscode.workspace.fs.createDirectory(paths.sceneDirectory),
    vscode.workspace.fs.createDirectory(paths.draftDirectory),
  ]);
}

export async function ensureWorkspaceGitignore(gitignoreUri: vscode.Uri): Promise<void> {
  if (!(await uriExists(gitignoreUri))) {
    await vscode.workspace.fs.writeFile(
      gitignoreUri,
      new TextEncoder().encode(STORYBOARD_GITIGNORE_BLOCK.trimStart()),
    );
    return;
  }

  const current = new TextDecoder().decode(await vscode.workspace.fs.readFile(gitignoreUri));
  if (current.includes('# Storyboard generated files')) {
    return;
  }

  const separator = current.endsWith('\n') ? '' : '\n';
  await vscode.workspace.fs.writeFile(
    gitignoreUri,
    new TextEncoder().encode(`${current}${separator}${STORYBOARD_GITIGNORE_BLOCK}`),
  );
}
