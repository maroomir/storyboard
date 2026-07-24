// Workspace-relative path conventions. Every path is expressed as a '/'-separated string relative
// to the workspace root so that both the VSCode extension (which joins them onto a vscode.Uri) and
// headless clients (which join them onto a filesystem path) share one definition.

export interface StoryboardRelativePaths {
  readonly metadataDirectory: string;
  readonly projectJson: string;
  readonly cacheDirectory: string;
  readonly usageLedger: string;
  readonly novelRunState: string;
  readonly sceneCacheDirectory: string;
  readonly personaMemoryDirectory: string;
  readonly backgroundMemoryDirectory: string;
  readonly bibleCacheDirectory: string;
  readonly cardCacheDirectory: string;
  readonly studioSessionDirectory: string;
  readonly bibleDirectory: string;
  readonly bibleCanon: string;
  readonly outlineDirectory: string;
  readonly outlineSynopsis: string;
  readonly outlineChapters: string;
  readonly outlineRevisionPlan: string;
  readonly characterDirectory: string;
  readonly characterProfileDirectory: string;
  readonly sampleCharacterCard: string;
  readonly backgroundDirectory: string;
  readonly sampleBackgroundCard: string;
  readonly sceneDirectory: string;
  readonly sampleScene: string;
  readonly draftDirectory: string;
  readonly draftHistoryDirectory: string;
  readonly manuscriptDirectory: string;
  readonly manuscriptVolume: string;
  readonly gitignore: string;
  readonly readme: string;
}

export const STORYBOARD_RELATIVE_PATHS: StoryboardRelativePaths = {
  metadataDirectory: '.storyboard',
  projectJson: '.storyboard/project.json',
  cacheDirectory: '.storyboard/cache',
  usageLedger: '.storyboard/cache/usage.json',
  novelRunState: '.storyboard/cache/novel-run.json',
  sceneCacheDirectory: '.storyboard/cache/scenes',
  personaMemoryDirectory: '.storyboard/cache/personas',
  backgroundMemoryDirectory: '.storyboard/cache/backgrounds',
  bibleCacheDirectory: '.storyboard/cache/bible',
  cardCacheDirectory: '.storyboard/cache/cards',
  studioSessionDirectory: '.storyboard/cache/studio-sessions',
  bibleDirectory: '.storyboard/bible',
  bibleCanon: '.storyboard/bible/canon.yaml',
  outlineDirectory: '.storyboard/outline',
  outlineSynopsis: '.storyboard/outline/synopsis.md',
  outlineChapters: '.storyboard/outline/chapters.yaml',
  outlineRevisionPlan: '.storyboard/outline/revision-plan.yaml',
  characterDirectory: 'character',
  characterProfileDirectory: 'character/profile',
  sampleCharacterCard: 'character/.sample.card',
  backgroundDirectory: 'background',
  sampleBackgroundCard: 'background/.sample.card',
  sceneDirectory: 'scene',
  sampleScene: 'scene/.sample.txt',
  draftDirectory: 'draft',
  draftHistoryDirectory: '.draft',
  manuscriptDirectory: 'manuscript',
  manuscriptVolume: 'manuscript/manuscript.md',
  gitignore: '.gitignore',
  readme: 'README.md',
};

export function characterCardRelativePath(id: string): string {
  return `character/${id}.card`;
}

export function characterProfileRelativePath(id: string): string {
  return `character/profile/${id}.png`;
}

export function backgroundCardRelativePath(id: string): string {
  return `background/${id}.card`;
}

export function sceneRelativePath(sceneStem: string): string {
  return `scene/${sceneStem}.txt`;
}

export function sceneFileRelativePath(prefix: string, slug: string): string {
  return `scene/${prefix}-${slug}.txt`;
}

export function draftRelativePath(sceneStem: string): string {
  return `draft/${sceneStem}.md`;
}

export function draftHistorySceneRelativeDirectory(sceneStem: string): string {
  return `.draft/${sceneStem}`;
}

export function isHiddenSceneFileName(fileName: string): boolean {
  return fileName.startsWith('.') && fileName.endsWith('.txt');
}

export function parseCardIdFromFileName(fileName: string): string | undefined {
  if (!fileName.endsWith('.card')) {
    return undefined;
  }

  return fileName.slice(0, -'.card'.length);
}

function isDirectChildWithExtension(
  relativePath: string,
  directory: string,
  extension: string,
): boolean {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
  const prefix = `${directory.toLowerCase()}/`;

  if (!normalized.startsWith(prefix)) {
    return false;
  }

  const remainder = normalized.slice(prefix.length);
  return !remainder.includes('/') && remainder.endsWith(extension);
}

export function isDraftMarkdownRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, 'draft', '.md');
}

export function isDirectSceneTextRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, 'scene', '.txt');
}
