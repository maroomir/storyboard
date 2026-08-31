import {
  STORYBOARD_RELATIVE_PATHS,
  backgroundCardRelativePath,
  characterCardRelativePath,
  characterProfileRelativePath,
  draftHistorySceneRelativeDirectory,
  draftRelativePath,
  isDirectBackgroundCardRelativePath,
  isDirectCharacterCardRelativePath,
  isDirectSceneCardRelativePath,
  isDraftMarkdownRelativePath,
  parseCardIdFromFileName,
  sceneFileRelativePath,
  sceneRelativePath,
} from '@storyboard/story-format';
import * as vscode from 'vscode';

import type { StudioEntity } from '../../shared/messaging';

export { isHiddenSceneFileName, isIgnoredSampleCardFileName } from '@storyboard/story-format';

export interface StoryboardProjectPaths {
  readonly workspaceRoot: vscode.Uri;
  readonly metadataDirectory: vscode.Uri;
  readonly projectJson: vscode.Uri;
  readonly cacheDirectory: vscode.Uri;
  readonly usageLedger: vscode.Uri;
  readonly novelRunState: vscode.Uri;
  readonly sceneCacheDirectory: vscode.Uri;
  readonly storyState: vscode.Uri;
  readonly sceneDialogueDirectory: vscode.Uri;
  readonly personaMemoryDirectory: vscode.Uri;
  readonly backgroundMemoryDirectory: vscode.Uri;
  readonly bibleCacheDirectory: vscode.Uri;
  readonly cardCacheDirectory: vscode.Uri;
  readonly studioSessionDirectory: vscode.Uri;
  readonly bibleDirectory: vscode.Uri;
  readonly bibleCanon: vscode.Uri;
  readonly outlineDirectory: vscode.Uri;
  readonly outlineSynopsis: vscode.Uri;
  readonly outlineChapters: vscode.Uri;
  readonly outlineRevisionPlan: vscode.Uri;
  readonly characterDirectory: vscode.Uri;
  readonly characterProfileDirectory: vscode.Uri;
  readonly sampleCharacterCard: vscode.Uri;
  readonly backgroundDirectory: vscode.Uri;
  readonly sampleBackgroundCard: vscode.Uri;
  readonly sceneDirectory: vscode.Uri;
  readonly sampleScene: vscode.Uri;
  readonly draftDirectory: vscode.Uri;
  readonly draftHistoryDirectory: vscode.Uri;
  readonly manuscriptDirectory: vscode.Uri;
  readonly manuscriptVolume: vscode.Uri;
  readonly gitignore: vscode.Uri;
  readonly readme: vscode.Uri;
}

function resolveWorkspacePath(workspaceRoot: vscode.Uri, relativePath: string): vscode.Uri {
  return vscode.Uri.joinPath(workspaceRoot, ...relativePath.split('/'));
}

export function getStoryboardProjectPaths(workspaceRoot: vscode.Uri): StoryboardProjectPaths {
  const resolve = (relativePath: string): vscode.Uri =>
    resolveWorkspacePath(workspaceRoot, relativePath);

  return {
    workspaceRoot,
    metadataDirectory: resolve(STORYBOARD_RELATIVE_PATHS.metadataDirectory),
    projectJson: resolve(STORYBOARD_RELATIVE_PATHS.projectJson),
    cacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.cacheDirectory),
    usageLedger: resolve(STORYBOARD_RELATIVE_PATHS.usageLedger),
    novelRunState: resolve(STORYBOARD_RELATIVE_PATHS.novelRunState),
    sceneCacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.sceneCacheDirectory),
    storyState: resolve(STORYBOARD_RELATIVE_PATHS.storyState),
    sceneDialogueDirectory: resolve(STORYBOARD_RELATIVE_PATHS.sceneDialogueDirectory),
    personaMemoryDirectory: resolve(STORYBOARD_RELATIVE_PATHS.personaMemoryDirectory),
    backgroundMemoryDirectory: resolve(STORYBOARD_RELATIVE_PATHS.backgroundMemoryDirectory),
    bibleCacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.bibleCacheDirectory),
    cardCacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.cardCacheDirectory),
    studioSessionDirectory: resolve(STORYBOARD_RELATIVE_PATHS.studioSessionDirectory),
    bibleDirectory: resolve(STORYBOARD_RELATIVE_PATHS.bibleDirectory),
    bibleCanon: resolve(STORYBOARD_RELATIVE_PATHS.bibleCanon),
    outlineDirectory: resolve(STORYBOARD_RELATIVE_PATHS.outlineDirectory),
    outlineSynopsis: resolve(STORYBOARD_RELATIVE_PATHS.outlineSynopsis),
    outlineChapters: resolve(STORYBOARD_RELATIVE_PATHS.outlineChapters),
    outlineRevisionPlan: resolve(STORYBOARD_RELATIVE_PATHS.outlineRevisionPlan),
    characterDirectory: resolve(STORYBOARD_RELATIVE_PATHS.characterDirectory),
    characterProfileDirectory: resolve(STORYBOARD_RELATIVE_PATHS.characterProfileDirectory),
    sampleCharacterCard: resolve(STORYBOARD_RELATIVE_PATHS.sampleCharacterCard),
    backgroundDirectory: resolve(STORYBOARD_RELATIVE_PATHS.backgroundDirectory),
    sampleBackgroundCard: resolve(STORYBOARD_RELATIVE_PATHS.sampleBackgroundCard),
    sceneDirectory: resolve(STORYBOARD_RELATIVE_PATHS.sceneDirectory),
    sampleScene: resolve(STORYBOARD_RELATIVE_PATHS.sampleScene),
    draftDirectory: resolve(STORYBOARD_RELATIVE_PATHS.draftDirectory),
    draftHistoryDirectory: resolve(STORYBOARD_RELATIVE_PATHS.draftHistoryDirectory),
    manuscriptDirectory: resolve(STORYBOARD_RELATIVE_PATHS.manuscriptDirectory),
    manuscriptVolume: resolve(STORYBOARD_RELATIVE_PATHS.manuscriptVolume),
    gitignore: resolve(STORYBOARD_RELATIVE_PATHS.gitignore),
    readme: resolve(STORYBOARD_RELATIVE_PATHS.readme),
  };
}

function workspaceRelativePath(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): string {
  const rootPath = workspaceFolder.uri.fsPath.replace(/\\/g, '/');
  const filePath = uri.fsPath.replace(/\\/g, '/');

  if (!filePath.startsWith(`${rootPath}/`)) {
    return '';
  }

  return filePath.slice(rootPath.length + 1);
}

export function isDraftMarkdownFile(
  uri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
): boolean {
  return isDraftMarkdownRelativePath(workspaceRelativePath(uri, workspaceFolder));
}

export function isDirectSceneCardFile(
  uri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
): boolean {
  return isDirectSceneCardRelativePath(workspaceRelativePath(uri, workspaceFolder));
}

// SECURITY: entity keys reach here from webview payloads and become directory names; anything
// outside the card/scene id shape would let a session escape the studio-sessions directory.
const safeEntityKeyPattern = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

// SECURITY: entity keys arrive from the webview and from model output, and they become path
// segments for both the session cache and the card/scene files themselves; anything outside the
// card id shape could read or overwrite a file outside the workspace.
export function isSafeStudioEntityKey(key: string): boolean {
  return safeEntityKeyPattern.test(key);
}

export function studioSessionEntityDirectory(
  workspaceRoot: vscode.Uri,
  entity: StudioEntity,
): vscode.Uri | undefined {
  if (!isSafeStudioEntityKey(entity.key)) {
    return undefined;
  }

  return vscode.Uri.joinPath(
    getStoryboardProjectPaths(workspaceRoot).studioSessionDirectory,
    entity.kind,
    entity.key,
  );
}

export function isDirectCharacterCardFile(
  uri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
): boolean {
  return isDirectCharacterCardRelativePath(workspaceRelativePath(uri, workspaceFolder));
}

export function isDirectBackgroundCardFile(
  uri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
): boolean {
  return isDirectBackgroundCardRelativePath(workspaceRelativePath(uri, workspaceFolder));
}

export function characterCardPath(workspaceRoot: vscode.Uri, id: string): vscode.Uri {
  return resolveWorkspacePath(workspaceRoot, characterCardRelativePath(id));
}

export function characterProfilePath(workspaceRoot: vscode.Uri, id: string): vscode.Uri {
  return resolveWorkspacePath(workspaceRoot, characterProfileRelativePath(id));
}

export function backgroundCardPath(workspaceRoot: vscode.Uri, id: string): vscode.Uri {
  return resolveWorkspacePath(workspaceRoot, backgroundCardRelativePath(id));
}

export function sceneFilePath(workspaceRoot: vscode.Uri, prefix: string, slug: string): vscode.Uri {
  return resolveWorkspacePath(workspaceRoot, sceneFileRelativePath(prefix, slug));
}

export function scenePath(workspaceRoot: vscode.Uri, sceneStem: string): vscode.Uri {
  return resolveWorkspacePath(workspaceRoot, sceneRelativePath(sceneStem));
}

export function draftPath(workspaceRoot: vscode.Uri, sceneStem: string): vscode.Uri {
  return resolveWorkspacePath(workspaceRoot, draftRelativePath(sceneStem));
}

export function joinUri(base: vscode.Uri, ...segments: string[]): vscode.Uri {
  return vscode.Uri.joinPath(base, ...segments);
}

export function draftHistorySceneDirectory(
  workspaceRoot: vscode.Uri,
  sceneStem: string,
): vscode.Uri {
  return resolveWorkspacePath(workspaceRoot, draftHistorySceneRelativeDirectory(sceneStem));
}

export function parseCardIdFromPath(uri: vscode.Uri): string | undefined {
  const fileName = uri.path.split('/').at(-1);

  return fileName === undefined ? undefined : parseCardIdFromFileName(fileName);
}
