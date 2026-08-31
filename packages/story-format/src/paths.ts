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
  readonly storyState: string;
  readonly sceneDialogueDirectory: string;
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
  storyState: '.storyboard/cache/storyState.md',
  sceneDialogueDirectory: '.storyboard/cache/dialogue',
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
  sampleScene: 'scene/.sample.card',
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
  return `scene/${sceneStem}.card`;
}

export function sceneFileRelativePath(prefix: string, slug: string): string {
  return `scene/${prefix}-${slug}.card`;
}

export function draftRelativePath(sceneStem: string): string {
  return `draft/${sceneStem}.md`;
}

export function draftHistorySceneRelativeDirectory(sceneStem: string): string {
  return `.draft/${sceneStem}`;
}

export function isHiddenSceneFileName(fileName: string): boolean {
  return fileName.startsWith('.') && fileName.endsWith('.card');
}

export function parseCardIdFromFileName(fileName: string): string | undefined {
  if (!fileName.endsWith('.card')) {
    return undefined;
  }

  return fileName.slice(0, -'.card'.length);
}

// Case-sensitive on purpose: the codecs only accept lowercase directory and file names, so a
// case-insensitive match here would classify files the parsers then reject.
function isDirectChildWithExtension(
  relativePath: string,
  directory: string,
  extension: string,
): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  const prefix = `${directory}/`;

  if (!normalized.startsWith(prefix)) {
    return false;
  }

  const remainder = normalized.slice(prefix.length);
  return !remainder.includes('/') && remainder.endsWith(extension);
}

export function isDraftMarkdownRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, 'draft', '.md');
}

export function isDirectSceneCardRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, 'scene', '.card');
}

export function isDirectCharacterCardRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, 'character', '.card');
}

export function isDirectBackgroundCardRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, 'background', '.card');
}

// 마이그레이션 전용: 구형 씬 텍스트(.txt)를 찾아 변환 대상으로 보고할 때만 쓴다.
export function isLegacySceneTextRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, 'scene', '.txt');
}
