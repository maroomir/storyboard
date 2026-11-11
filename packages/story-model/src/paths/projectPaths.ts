import {
  backgroundCardRelativePath,
  characterCardRelativePath,
  characterProfileRelativePath,
  isDirectBackgroundCardRelativePath,
  isDirectCharacterCardRelativePath,
  narratorCardRelativePath,
  parseElementSlugFromCardPath,
  sceneCardRelativePath,
} from '#model/format/bundlePaths';
import {
  STORYBOARD_RELATIVE_PATHS,
  draftRelativePath,
  isDirectSceneCardRelativePath,
  isDraftMarkdownRelativePath,
  parseCardIdFromFileName,
  sceneRelativePath,
} from '#model/format/paths';
import { mainThreadId } from '#model/format/project';
import { joinStoryPath, type StoryUri, type StoryWorkspaceFolder } from '#model/paths/storyUri';


export interface StoryboardProjectPaths {
  readonly workspaceRoot: StoryUri;
  readonly threadId: string;
  readonly metadataDirectory: StoryUri;
  readonly projectJson: StoryUri;
  readonly structure: StoryUri;
  readonly cacheDatabase: StoryUri;
  readonly cacheDirectory: StoryUri;
  readonly sceneCacheDirectory: StoryUri;
  readonly revisionRoundsDirectory: StoryUri;
  readonly cardCacheDirectory: StoryUri;
  readonly noteCacheDirectory: StoryUri;
  readonly noteSource: StoryUri;
  readonly notePlan: StoryUri;
  readonly noteCandidates: StoryUri;
  readonly interviewCacheDirectory: StoryUri;
  readonly interviewWorkingModelDirectory: StoryUri;
  readonly interviewAxes: StoryUri;
  readonly interviewCandidates: StoryUri;
  readonly noteSynopsisCandidate: StoryUri;
  readonly noteExtractionResponses: StoryUri;
  readonly outlineDirectory: StoryUri;
  readonly outlineSynopsis: StoryUri;
  readonly outlineChapters: StoryUri;
  readonly pendingChapterPlan: StoryUri;
  readonly characterDirectory: StoryUri;
  readonly backgroundDirectory: StoryUri;
  readonly narratorDirectory: StoryUri;
  readonly sceneDirectory: StoryUri;
  readonly draftDirectory: StoryUri;
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

type InterviewProjectPaths = Pick<
  StoryboardProjectPaths,
  'interviewCacheDirectory' | 'interviewWorkingModelDirectory' | 'interviewAxes' | 'interviewCandidates'
>;

function resolveInterviewPaths(resolve: (relativePath: string) => StoryUri): InterviewProjectPaths {
  return {
    interviewCacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.interviewCacheDirectory),
    interviewWorkingModelDirectory: resolve(STORYBOARD_RELATIVE_PATHS.interviewWorkingModelDirectory),
    interviewAxes: resolve(STORYBOARD_RELATIVE_PATHS.interviewAxes),
    interviewCandidates: resolve(STORYBOARD_RELATIVE_PATHS.interviewCandidates),
  };
}

export function getStoryboardProjectPaths(workspaceRoot: StoryUri): StoryboardProjectPaths {
  const resolve = (relativePath: string): StoryUri =>
    resolveWorkspacePath(workspaceRoot, relativePath);

  return {
    workspaceRoot,
    threadId: mainThreadId,
    metadataDirectory: resolve(STORYBOARD_RELATIVE_PATHS.metadataDirectory),
    projectJson: resolve(STORYBOARD_RELATIVE_PATHS.projectJson),
    structure: resolve(STORYBOARD_RELATIVE_PATHS.structure),
    cacheDatabase: resolve(STORYBOARD_RELATIVE_PATHS.cacheDatabase),
    cacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.cacheDirectory),
    sceneCacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.sceneCacheDirectory),
    revisionRoundsDirectory: resolve(STORYBOARD_RELATIVE_PATHS.revisionRoundsDirectory),
    cardCacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.cardCacheDirectory),
    noteCacheDirectory: resolve(STORYBOARD_RELATIVE_PATHS.noteCacheDirectory),
    noteSource: resolve(STORYBOARD_RELATIVE_PATHS.noteSource),
    notePlan: resolve(STORYBOARD_RELATIVE_PATHS.notePlan),
    noteCandidates: resolve(STORYBOARD_RELATIVE_PATHS.noteCandidates),
    ...resolveInterviewPaths(resolve),
    noteSynopsisCandidate: resolve(STORYBOARD_RELATIVE_PATHS.noteSynopsisCandidate),
    noteExtractionResponses: resolve(STORYBOARD_RELATIVE_PATHS.noteExtractionResponses),
    outlineDirectory: resolve(STORYBOARD_RELATIVE_PATHS.outlineDirectory),
    outlineSynopsis: resolve(STORYBOARD_RELATIVE_PATHS.outlineSynopsis),
    outlineChapters: resolve(STORYBOARD_RELATIVE_PATHS.outlineChapters),
    pendingChapterPlan: resolve(STORYBOARD_RELATIVE_PATHS.pendingChapterPlan),
    characterDirectory: resolve(STORYBOARD_RELATIVE_PATHS.characterDirectory),
    backgroundDirectory: resolve(STORYBOARD_RELATIVE_PATHS.backgroundDirectory),
    narratorDirectory: resolve(STORYBOARD_RELATIVE_PATHS.narratorDirectory),
    sceneDirectory: resolve(STORYBOARD_RELATIVE_PATHS.sceneDirectory),
    draftDirectory: resolve(STORYBOARD_RELATIVE_PATHS.draftDirectory),
    manuscriptDirectory: resolve(STORYBOARD_RELATIVE_PATHS.manuscriptDirectory),
    manuscriptVolume: resolve(STORYBOARD_RELATIVE_PATHS.manuscriptVolume),
    gitignore: resolve(STORYBOARD_RELATIVE_PATHS.gitignore),
    readme: resolve(STORYBOARD_RELATIVE_PATHS.readme),
    agentGuide: resolve(STORYBOARD_RELATIVE_PATHS.agentGuide),
    claudeGuide: resolve(STORYBOARD_RELATIVE_PATHS.claudeGuide),
  };
}

export function resolveThreadPaths(
  paths: StoryboardProjectPaths,
  threadId: string | undefined,
): StoryboardProjectPaths {
  if (threadId === undefined || threadId === mainThreadId) {
    return paths;
  }

  return { ...paths, threadId };
}

function workspaceRelativePath(uri: StoryUri, workspaceFolder: StoryWorkspaceFolder): string {
  const rootPath: string = workspaceFolder.uri.fsPath.replace(/\\/g, '/');
  const filePath: string = uri.fsPath.replace(/\\/g, '/');

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

const safeEntityKeyPattern: RegExp = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

export function isSafeStudioEntityKey(key: string): boolean {
  return safeEntityKeyPattern.test(key);
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

export function narratorCardPath(workspaceRoot: StoryUri, id: string): StoryUri {
  return resolveWorkspacePath(workspaceRoot, narratorCardRelativePath(id));
}

export function sceneCardPath(workspaceRoot: StoryUri, sceneStem: string): StoryUri {
  return resolveWorkspacePath(workspaceRoot, sceneCardRelativePath(sceneStem));
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

export function parseCardIdFromPath(uri: StoryUri): string | undefined {
  const bundleSlug: string | undefined = parseElementSlugFromCardPath(uri.path);
  const fileName: string | undefined = uri.path.split('/').at(-1);

  return bundleSlug ?? (fileName === undefined ? undefined : parseCardIdFromFileName(fileName));
}
