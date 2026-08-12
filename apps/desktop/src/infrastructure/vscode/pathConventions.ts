import {
  storyboardRelativePaths,
  backgroundCardRelativePath,
  characterCardRelativePath,
  characterProfileRelativePath,
  draftHistorySceneRelativeDirectory,
  draftRelativePath,
  isDirectSceneTextRelativePath,
  isDraftMarkdownRelativePath,
  parseCardIdFromFileName,
  sceneFileRelativePath,
  sceneRelativePath,
} from '@seedkernel/wasm';
import * as vscode from 'vscode';

export { isHiddenSceneFileName } from '@seedkernel/wasm';
export { isIgnoredSampleCardFileName } from '@/domain/sampleCard';

export interface StoryboardProjectPaths {
  readonly workspaceRoot: vscode.Uri;
  readonly metadataDirectory: vscode.Uri;
  readonly projectJson: vscode.Uri;
  readonly cacheDirectory: vscode.Uri;
  readonly usageLedger: vscode.Uri;
  readonly novelRunState: vscode.Uri;
  readonly sceneCacheDirectory: vscode.Uri;
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
  const relativePaths = storyboardRelativePaths();

  return {
    workspaceRoot,
    metadataDirectory: resolve(relativePaths.metadataDirectory),
    projectJson: resolve(relativePaths.projectJson),
    cacheDirectory: resolve(relativePaths.cacheDirectory),
    usageLedger: resolve(relativePaths.usageLedger),
    novelRunState: resolve(relativePaths.novelRunState),
    sceneCacheDirectory: resolve(relativePaths.sceneCacheDirectory),
    personaMemoryDirectory: resolve(relativePaths.personaMemoryDirectory),
    backgroundMemoryDirectory: resolve(relativePaths.backgroundMemoryDirectory),
    bibleCacheDirectory: resolve(relativePaths.bibleCacheDirectory),
    cardCacheDirectory: resolve(relativePaths.cardCacheDirectory),
    studioSessionDirectory: resolve(relativePaths.studioSessionDirectory),
    bibleDirectory: resolve(relativePaths.bibleDirectory),
    bibleCanon: resolve(relativePaths.bibleCanon),
    outlineDirectory: resolve(relativePaths.outlineDirectory),
    outlineSynopsis: resolve(relativePaths.outlineSynopsis),
    outlineChapters: resolve(relativePaths.outlineChapters),
    outlineRevisionPlan: resolve(relativePaths.outlineRevisionPlan),
    characterDirectory: resolve(relativePaths.characterDirectory),
    characterProfileDirectory: resolve(relativePaths.characterProfileDirectory),
    sampleCharacterCard: resolve(relativePaths.sampleCharacterCard),
    backgroundDirectory: resolve(relativePaths.backgroundDirectory),
    sampleBackgroundCard: resolve(relativePaths.sampleBackgroundCard),
    sceneDirectory: resolve(relativePaths.sceneDirectory),
    sampleScene: resolve(relativePaths.sampleScene),
    draftDirectory: resolve(relativePaths.draftDirectory),
    draftHistoryDirectory: resolve(relativePaths.draftHistoryDirectory),
    manuscriptDirectory: resolve(relativePaths.manuscriptDirectory),
    manuscriptVolume: resolve(relativePaths.manuscriptVolume),
    gitignore: resolve(relativePaths.gitignore),
    readme: resolve(relativePaths.readme),
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

export function isDirectSceneTextFile(
  uri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
): boolean {
  return isDirectSceneTextRelativePath(workspaceRelativePath(uri, workspaceFolder));
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
