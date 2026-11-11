import * as vscode from 'vscode';

import { resolveSceneBundleStem, scenePath } from '@storyboard/story-model';
import { resolveActiveFileUri } from '@/presentation/commands/activeFileUri';

export interface SceneBundleTarget {
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly stem: string;
  readonly sceneUri: vscode.Uri;
}

export function resolveSceneBundleTarget(uri: vscode.Uri): SceneBundleTarget | undefined {
  const workspaceFolder: vscode.WorkspaceFolder | undefined =
    vscode.workspace.getWorkspaceFolder(uri);
  const stem: string | undefined =
    workspaceFolder === undefined ? undefined : resolveSceneBundleStem(uri, workspaceFolder);

  return workspaceFolder === undefined || stem === undefined
    ? undefined
    : { workspaceFolder, stem, sceneUri: scenePath(workspaceFolder.uri, stem) as vscode.Uri };
}

function toSceneBundleUri(uri: vscode.Uri): vscode.Uri {
  return resolveSceneBundleTarget(uri)?.sceneUri ?? uri;
}

export function resolveSceneUriFromInvocation(invokedUri?: vscode.Uri): vscode.Uri | undefined {
  const candidateUri: vscode.Uri | undefined =
    invokedUri?.scheme === 'file' ? invokedUri : resolveActiveFileUri();

  return candidateUri === undefined ? undefined : toSceneBundleUri(candidateUri);
}
