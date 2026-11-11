
interface StoryboardRelativePaths {
  readonly metadataDirectory: string;
  readonly projectJson: string;
  readonly structure: string;
  readonly cacheDatabase: string;
  readonly cacheDirectory: string;
  readonly sceneRenameJournal: string;
  readonly sceneCacheDirectory: string;
  readonly revisionRoundsDirectory: string;
  readonly cardCacheDirectory: string;
  readonly noteCacheDirectory: string;
  readonly noteSource: string;
  readonly notePlan: string;
  readonly noteCandidates: string;
  readonly noteSynopsisCandidate: string;
  readonly noteExtractionResponses: string;
  readonly studioSessionDirectory: string;
  readonly interviewCacheDirectory: string;
  readonly interviewWorkingModelDirectory: string;
  readonly interviewAxes: string;
  readonly interviewCandidates: string;
  readonly outlineDirectory: string;
  readonly outlineSynopsis: string;
  readonly outlineChapters: string;
  readonly pendingChapterPlan: string;
  readonly characterDirectory: string;
  readonly backgroundDirectory: string;
  readonly narratorDirectory: string;
  readonly sceneDirectory: string;
  readonly draftDirectory: string;
  readonly draftHistoryDirectory: string;
  readonly manuscriptDirectory: string;
  readonly manuscriptVolume: string;
  readonly gitignore: string;
  readonly readme: string;
  readonly agentGuide: string;
  readonly claudeGuide: string;
}

export const STORYBOARD_RELATIVE_PATHS: StoryboardRelativePaths = {
  metadataDirectory: '.storyboard',
  projectJson: '.storyboard/project.json',
  structure: '.storyboard/structure.yaml',
  cacheDatabase: '.storyboard/cache/storyboard.db',
  cacheDirectory: '.storyboard/cache',
  sceneRenameJournal: '.storyboard/cache/scene-rename.json',
  sceneCacheDirectory: '.storyboard/cache/scenes',
  revisionRoundsDirectory: '.storyboard/cache/revisions',
  cardCacheDirectory: '.storyboard/cache/cards',
  noteCacheDirectory: '.storyboard/cache/notes',
  noteSource: '.storyboard/cache/notes/source.json',
  notePlan: '.storyboard/cache/notes/plan.json',
  noteCandidates: '.storyboard/cache/notes/candidates.json',
  noteSynopsisCandidate: '.storyboard/cache/notes/synopsis.candidate.md',
  noteExtractionResponses: '.storyboard/cache/notes/responses.json',
  studioSessionDirectory: '.storyboard/cache/studio-sessions',
  interviewCacheDirectory: '.storyboard/cache/interviews',
  interviewWorkingModelDirectory: '.storyboard/cache/interviews/cards',
  interviewAxes: '.storyboard/cache/interviews/axes.json',
  interviewCandidates: '.storyboard/cache/interviews/candidates.json',
  outlineDirectory: '.storyboard/outline',
  outlineSynopsis: '.storyboard/outline/synopsis.md',
  outlineChapters: '.storyboard/outline/chapters.yaml',
  pendingChapterPlan: '.storyboard/cache/outline/pending-chapters.yaml',
  characterDirectory: 'character',
  backgroundDirectory: 'background',
  narratorDirectory: 'narrator',
  sceneDirectory: 'scene',
  draftDirectory: 'draft',
  draftHistoryDirectory: '.draft',
  manuscriptDirectory: 'manuscript',
  manuscriptVolume: 'manuscript/manuscript.md',
  gitignore: '.gitignore',
  readme: 'README.md',
  agentGuide: 'AGENTS.md',
  claudeGuide: 'CLAUDE.md',
};

interface StoryboardFileExtensions {
  readonly card: string;
  readonly draft: string;
  readonly profileImage: string;
  readonly legacyScene: string;
}

export const STORYBOARD_FILE_EXTENSIONS: StoryboardFileExtensions = {
  card: '.card',
  draft: '.md',
  profileImage: '.png',
  legacyScene: '.txt',
};

interface StoryboardGlobs {
  readonly characterCards: string;
  readonly backgroundCards: string;
  readonly sceneCards: string;
  readonly draftMarkdown: string;
  readonly anyDraftMarkdown: string;
}

export const STORYBOARD_GLOBS: StoryboardGlobs = {
  characterCards: `${STORYBOARD_RELATIVE_PATHS.characterDirectory}/*${STORYBOARD_FILE_EXTENSIONS.card}`,
  backgroundCards: `${STORYBOARD_RELATIVE_PATHS.backgroundDirectory}/*${STORYBOARD_FILE_EXTENSIONS.card}`,
  sceneCards: `${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/*${STORYBOARD_FILE_EXTENSIONS.card}`,
  draftMarkdown: `${STORYBOARD_RELATIVE_PATHS.draftDirectory}/**/*${STORYBOARD_FILE_EXTENSIONS.draft}`,
  anyDraftMarkdown: `**/${STORYBOARD_RELATIVE_PATHS.draftDirectory}/*${STORYBOARD_FILE_EXTENSIONS.draft}`,
};

export function interviewWorkingModelRelativePath(cardId: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.interviewWorkingModelDirectory}/${cardId}.json`;
}

export function sceneRelativePath(sceneStem: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/${sceneStem}${STORYBOARD_FILE_EXTENSIONS.card}`;
}

export function draftRelativePath(sceneStem: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.draftDirectory}/${sceneStem}${STORYBOARD_FILE_EXTENSIONS.draft}`;
}

export function draftHistorySceneRelativeDirectory(sceneStem: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.draftHistoryDirectory}/${sceneStem}`;
}

export function parseCardIdFromFileName(fileName: string): string | undefined {
  if (!fileName.endsWith(STORYBOARD_FILE_EXTENSIONS.card)) {
    return undefined;
  }

  return fileName.slice(0, -STORYBOARD_FILE_EXTENSIONS.card.length);
}

function isDirectChildWithExtension(
  relativePath: string,
  directory: string,
  extension: string,
): boolean {
  const normalized: string = relativePath.replace(/\\/g, '/');
  const prefix: string = `${directory}/`;

  if (!normalized.startsWith(prefix)) {
    return false;
  }

  const remainder: string = normalized.slice(prefix.length);
  return !remainder.includes('/') && remainder.endsWith(extension);
}

export function isDraftMarkdownRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, STORYBOARD_RELATIVE_PATHS.draftDirectory, STORYBOARD_FILE_EXTENSIONS.draft);
}

export function isDirectSceneCardRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, STORYBOARD_RELATIVE_PATHS.sceneDirectory, STORYBOARD_FILE_EXTENSIONS.card);
}

export function isLegacySceneTextRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, STORYBOARD_RELATIVE_PATHS.sceneDirectory, STORYBOARD_FILE_EXTENSIONS.legacyScene);
}
