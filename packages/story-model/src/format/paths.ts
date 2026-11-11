
interface StoryboardRelativePaths {
  readonly metadataDirectory: string;
  readonly projectJson: string;
  readonly structure: string;
  readonly cacheDatabase: string;
  readonly cacheDirectory: string;
  readonly sceneCacheDirectory: string;
  readonly revisionRoundsDirectory: string;
  readonly cardCacheDirectory: string;
  readonly outlineDirectory: string;
  readonly outlineSynopsis: string;
  readonly outlineChapters: string;
  readonly pendingChapterPlan: string;
  readonly characterDirectory: string;
  readonly backgroundDirectory: string;
  readonly narratorDirectory: string;
  readonly sceneDirectory: string;
  readonly draftDirectory: string;
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
  sceneCacheDirectory: '.storyboard/cache/scenes',
  revisionRoundsDirectory: '.storyboard/cache/revisions',
  cardCacheDirectory: '.storyboard/cache/cards',
  outlineDirectory: '.storyboard/outline',
  outlineSynopsis: '.storyboard/outline/synopsis.md',
  outlineChapters: '.storyboard/outline/chapters.yaml',
  pendingChapterPlan: '.storyboard/cache/outline/pending-chapters.yaml',
  characterDirectory: 'character',
  backgroundDirectory: 'background',
  narratorDirectory: 'narrator',
  sceneDirectory: 'scene',
  draftDirectory: 'draft',
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
  readonly characterBundleFiles: string;
  readonly backgroundBundleFiles: string;
  readonly sceneBundleFiles: string;
  readonly draftMarkdown: string;
  readonly anyDraftMarkdown: string;
}

const bundleYamlExtension: string = '.yaml';

export const STORYBOARD_GLOBS: StoryboardGlobs = {
  characterBundleFiles: `${STORYBOARD_RELATIVE_PATHS.characterDirectory}/*${STORYBOARD_FILE_EXTENSIONS.card}/*${bundleYamlExtension}`,
  backgroundBundleFiles: `${STORYBOARD_RELATIVE_PATHS.backgroundDirectory}/*${STORYBOARD_FILE_EXTENSIONS.card}/*${bundleYamlExtension}`,
  sceneBundleFiles: `${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/*${STORYBOARD_FILE_EXTENSIONS.card}/*${bundleYamlExtension}`,
  draftMarkdown: `${STORYBOARD_RELATIVE_PATHS.draftDirectory}/**/*${STORYBOARD_FILE_EXTENSIONS.draft}`,
  anyDraftMarkdown: `**/${STORYBOARD_RELATIVE_PATHS.draftDirectory}/*${STORYBOARD_FILE_EXTENSIONS.draft}`,
};

export function sceneRelativePath(sceneStem: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/${sceneStem}${STORYBOARD_FILE_EXTENSIONS.card}`;
}

export function draftRelativePath(sceneStem: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.draftDirectory}/${sceneStem}${STORYBOARD_FILE_EXTENSIONS.draft}`;
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
