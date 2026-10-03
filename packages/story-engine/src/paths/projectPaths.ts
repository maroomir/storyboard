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
  mainThreadId,
  parseCardIdFromFileName,
  sceneFileRelativePath,
  sceneRelativePath,
  threadMemoryRelativePath,
} from '@storyboard/story-model';
import { joinStoryPath, type StoryUri, type StoryWorkspaceFolder } from './storyUri';

import type { StudioEntity } from '#engine/shared/messaging/index';

export { isHiddenSceneFileName, isIgnoredSampleCardFileName } from '@storyboard/story-model';

export interface StoryboardProjectPaths {
  readonly workspaceRoot: StoryUri;
  readonly metadataDirectory: StoryUri;
  readonly projectJson: StoryUri;
  readonly cacheDirectory: StoryUri;
  readonly memoryDirectory: StoryUri;
  readonly threadMemoryDirectory: StoryUri;
  readonly usageLedger: StoryUri;
  readonly novelRunState: StoryUri;
  readonly runLock: StoryUri;
  readonly sceneRenameJournal: StoryUri;
  readonly sceneCacheDirectory: StoryUri;
  readonly storyState: StoryUri;
  readonly chapterSummaries: StoryUri;
  readonly sceneDialogueDirectory: StoryUri;
  readonly personaMemoryDirectory: StoryUri;
  readonly backgroundMemoryDirectory: StoryUri;
  readonly bibleCacheDirectory: StoryUri;
  readonly cardCacheDirectory: StoryUri;
  readonly noteCacheDirectory: StoryUri;
  readonly noteSource: StoryUri;
  readonly notePlan: StoryUri;
  readonly noteCandidates: StoryUri;
  readonly noteSynopsisCandidate: StoryUri;
  readonly studioSessionDirectory: StoryUri;
  readonly bibleDirectory: StoryUri;
  readonly bibleCanon: StoryUri;
  readonly outlineDirectory: StoryUri;
  readonly outlineSynopsis: StoryUri;
  readonly outlineChapters: StoryUri;
  readonly outlineRevisionPlan: StoryUri;
  readonly characterDirectory: StoryUri;
  readonly characterProfileDirectory: StoryUri;
  readonly sampleCharacterCard: StoryUri;
  readonly backgroundDirectory: StoryUri;
  readonly sampleBackgroundCard: StoryUri;
  readonly narratorDirectory: StoryUri;
  readonly sceneDirectory: StoryUri;
  readonly sampleScene: StoryUri;
  readonly draftDirectory: StoryUri;
  readonly draftHistoryDirectory: StoryUri;
  readonly manuscriptDirectory: StoryUri;
  readonly manuscriptVolume: StoryUri;
  readonly gitignore: StoryUri;
  readonly readme: StoryUri;
  readonly agentGuide: StoryUri;
  readonly claudeGuide: StoryUri;
}

function resolveWorkspacePath(workspaceRoot: StoryUri, relativePath: string): StoryUri {
  return joinStoryPath(workspaceRoot, ...relativePath.split('/'));
}

export function getStoryboardProjectPaths(workspaceRoot: StoryUri): StoryboardProjectPaths {
  const resolve = (relativePath: string): StoryUri =>
    resolveWorkspacePath(workspaceRoot, relativePath);

  return {
    workspaceRoot,
    metadataDirectory: resolve(STORYBOARD_RELATIVE_PATHS.metadataDirectory),
    projectJson: resolve(STORYBOARD_RELATIVE_PATHS.projectJson),
    cacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.cacheDirectory),
    memoryDirectory: resolve(STORYBOARD_RELATIVE_PATHS.memoryDirectory),
    threadMemoryDirectory: resolve(STORYBOARD_RELATIVE_PATHS.threadMemoryDirectory),
    usageLedger: resolve(STORYBOARD_RELATIVE_PATHS.usageLedger),
    novelRunState: resolve(STORYBOARD_RELATIVE_PATHS.novelRunState),
    runLock: resolve(STORYBOARD_RELATIVE_PATHS.runLock),
    sceneRenameJournal: resolve(STORYBOARD_RELATIVE_PATHS.sceneRenameJournal),
    sceneCacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.sceneCacheDirectory),
    storyState: resolve(STORYBOARD_RELATIVE_PATHS.storyState),
    chapterSummaries: resolve(STORYBOARD_RELATIVE_PATHS.chapterSummaries),
    sceneDialogueDirectory: resolve(STORYBOARD_RELATIVE_PATHS.sceneDialogueDirectory),
    personaMemoryDirectory: resolve(STORYBOARD_RELATIVE_PATHS.personaMemoryDirectory),
    backgroundMemoryDirectory: resolve(STORYBOARD_RELATIVE_PATHS.backgroundMemoryDirectory),
    bibleCacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.bibleCacheDirectory),
    cardCacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.cardCacheDirectory),
    noteCacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.noteCacheDirectory),
    noteSource: resolve(STORYBOARD_RELATIVE_PATHS.noteSource),
    notePlan: resolve(STORYBOARD_RELATIVE_PATHS.notePlan),
    noteCandidates: resolve(STORYBOARD_RELATIVE_PATHS.noteCandidates),
    noteSynopsisCandidate: resolve(STORYBOARD_RELATIVE_PATHS.noteSynopsisCandidate),
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
    narratorDirectory: resolve(STORYBOARD_RELATIVE_PATHS.narratorDirectory),
    sceneDirectory: resolve(STORYBOARD_RELATIVE_PATHS.sceneDirectory),
    sampleScene: resolve(STORYBOARD_RELATIVE_PATHS.sampleScene),
    draftDirectory: resolve(STORYBOARD_RELATIVE_PATHS.draftDirectory),
    draftHistoryDirectory: resolve(STORYBOARD_RELATIVE_PATHS.draftHistoryDirectory),
    manuscriptDirectory: resolve(STORYBOARD_RELATIVE_PATHS.manuscriptDirectory),
    manuscriptVolume: resolve(STORYBOARD_RELATIVE_PATHS.manuscriptVolume),
    gitignore: resolve(STORYBOARD_RELATIVE_PATHS.gitignore),
    readme: resolve(STORYBOARD_RELATIVE_PATHS.readme),
    agentGuide: resolve(STORYBOARD_RELATIVE_PATHS.agentGuide),
    claudeGuide: resolve(STORYBOARD_RELATIVE_PATHS.claudeGuide),
  };
}

// NOTE: 연속성 재료만 줄기별로 가른다. 캐넌·아웃라인·씬·초안은 작품 하나에 하나라 그대로 둔다.
// 기본 줄기는 종전 경로를 그대로 써서 스레드를 쓰지 않는 작품의 파일 배치가 달라지지 않는다.
export function resolveThreadPaths(
  paths: StoryboardProjectPaths,
  threadId: string | undefined,
): StoryboardProjectPaths {
  if (threadId === undefined || threadId === mainThreadId) {
    return paths;
  }

  const resolveThreadPath = (relativePath: string): StoryUri =>
    resolveWorkspacePath(paths.workspaceRoot, threadMemoryRelativePath(threadId, relativePath));

  return {
    ...paths,
    storyState: resolveThreadPath(STORYBOARD_RELATIVE_PATHS.storyState),
    chapterSummaries: resolveThreadPath(STORYBOARD_RELATIVE_PATHS.chapterSummaries),
    sceneDialogueDirectory: resolveThreadPath(STORYBOARD_RELATIVE_PATHS.sceneDialogueDirectory),
    personaMemoryDirectory: resolveThreadPath(STORYBOARD_RELATIVE_PATHS.personaMemoryDirectory),
    backgroundMemoryDirectory: resolveThreadPath(
      STORYBOARD_RELATIVE_PATHS.backgroundMemoryDirectory,
    ),
  };
}

function workspaceRelativePath(uri: StoryUri, workspaceFolder: StoryWorkspaceFolder): string {
  const rootPath = workspaceFolder.uri.fsPath.replace(/\\/g, '/');
  const filePath = uri.fsPath.replace(/\\/g, '/');

  if (!filePath.startsWith(`${rootPath}/`)) {
    return '';
  }

  return filePath.slice(rootPath.length + 1);
}

export function isDraftMarkdownFile(uri: StoryUri, workspaceFolder: StoryWorkspaceFolder): boolean {
  return isDraftMarkdownRelativePath(workspaceRelativePath(uri, workspaceFolder));
}

export function isDirectSceneCardFile(
  uri: StoryUri,
  workspaceFolder: StoryWorkspaceFolder,
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
  workspaceRoot: StoryUri,
  entity: StudioEntity,
): StoryUri | undefined {
  if (!isSafeStudioEntityKey(entity.key)) {
    return undefined;
  }

  return joinStoryPath(
    getStoryboardProjectPaths(workspaceRoot).studioSessionDirectory,
    entity.kind,
    entity.key,
  );
}

export function isDirectCharacterCardFile(
  uri: StoryUri,
  workspaceFolder: StoryWorkspaceFolder,
): boolean {
  return isDirectCharacterCardRelativePath(workspaceRelativePath(uri, workspaceFolder));
}

export function isDirectBackgroundCardFile(
  uri: StoryUri,
  workspaceFolder: StoryWorkspaceFolder,
): boolean {
  return isDirectBackgroundCardRelativePath(workspaceRelativePath(uri, workspaceFolder));
}

export function characterCardPath(workspaceRoot: StoryUri, id: string): StoryUri {
  return resolveWorkspacePath(workspaceRoot, characterCardRelativePath(id));
}

export function characterProfilePath(workspaceRoot: StoryUri, id: string): StoryUri {
  return resolveWorkspacePath(workspaceRoot, characterProfileRelativePath(id));
}

export function backgroundCardPath(workspaceRoot: StoryUri, id: string): StoryUri {
  return resolveWorkspacePath(workspaceRoot, backgroundCardRelativePath(id));
}

export function sceneFilePath(workspaceRoot: StoryUri, prefix: string, slug: string): StoryUri {
  return resolveWorkspacePath(workspaceRoot, sceneFileRelativePath(prefix, slug));
}

export function scenePath(workspaceRoot: StoryUri, sceneStem: string): StoryUri {
  return resolveWorkspacePath(workspaceRoot, sceneRelativePath(sceneStem));
}

export function draftPath(workspaceRoot: StoryUri, sceneStem: string): StoryUri {
  return resolveWorkspacePath(workspaceRoot, draftRelativePath(sceneStem));
}

export function joinUri(base: StoryUri, ...segments: string[]): StoryUri {
  return joinStoryPath(base, ...segments);
}

export function draftHistorySceneDirectory(workspaceRoot: StoryUri, sceneStem: string): StoryUri {
  return resolveWorkspacePath(workspaceRoot, draftHistorySceneRelativeDirectory(sceneStem));
}

export function parseCardIdFromPath(uri: StoryUri): string | undefined {
  const fileName = uri.path.split('/').at(-1);

  return fileName === undefined ? undefined : parseCardIdFromFileName(fileName);
}
