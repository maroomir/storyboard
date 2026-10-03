import { sampleCardFileName } from './sampleCard';

// Workspace-relative path conventions. Every path is expressed as a '/'-separated string relative
// to the workspace root so that both the VSCode extension (which joins them onto a vscode.Uri) and
// headless clients (which join them onto a filesystem path) share one definition.

export interface StoryboardRelativePaths {
  readonly metadataDirectory: string;
  readonly projectJson: string;
  readonly cacheDirectory: string;
  readonly memoryDirectory: string;
  readonly threadMemoryDirectory: string;
  readonly usageLedger: string;
  readonly novelRunState: string;
  readonly runLock: string;
  readonly sceneRenameJournal: string;
  readonly sceneCacheDirectory: string;
  readonly storyState: string;
  readonly chapterSummaries: string;
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
  readonly narratorDirectory: string;
  readonly sceneDirectory: string;
  readonly sampleScene: string;
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
  cacheDirectory: '.storyboard/cache',
  memoryDirectory: '.storyboard/memory',
  threadMemoryDirectory: '.storyboard/memory/threads',
  usageLedger: '.storyboard/cache/usage.json',
  novelRunState: '.storyboard/cache/novel-run.json',
  runLock: '.storyboard/cache/run.lock',
  sceneRenameJournal: '.storyboard/cache/scene-rename.json',
  sceneCacheDirectory: '.storyboard/cache/scenes',
  storyState: '.storyboard/memory/storyState.md',
  chapterSummaries: '.storyboard/memory/summaries.md',
  sceneDialogueDirectory: '.storyboard/memory/dialogue',
  personaMemoryDirectory: '.storyboard/memory/personas',
  backgroundMemoryDirectory: '.storyboard/memory/backgrounds',
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
  sampleCharacterCard: `character/${sampleCardFileName}`,
  backgroundDirectory: 'background',
  sampleBackgroundCard: `background/${sampleCardFileName}`,
  narratorDirectory: 'narrator',
  sceneDirectory: 'scene',
  sampleScene: `scene/${sampleCardFileName}`,
  draftDirectory: 'draft',
  draftHistoryDirectory: '.draft',
  manuscriptDirectory: 'manuscript',
  manuscriptVolume: 'manuscript/manuscript.md',
  gitignore: '.gitignore',
  readme: 'README.md',
  agentGuide: 'AGENTS.md',
  claudeGuide: 'CLAUDE.md',
};

// 워크스페이스 파일의 확장자. 경로를 만드는 쪽과 판정하는 쪽이 같은 글자를 봐야 «만들 때는
// .card, 찾을 때는 .cards» 같은 어긋남이 생기지 않는다.
export const STORYBOARD_FILE_EXTENSIONS = {
  card: '.card',
  draft: '.md',
  profileImage: '.png',
  // 마이그레이션 전용: 구형 씬 텍스트.
  legacyScene: '.txt',
} as const;

// 확장자까지 붙은 글롭. 에디터 쪽 파일 감시자와 문서 선택자가 디렉터리 이름을 다시 적지 않게 한다.
export const STORYBOARD_GLOBS = {
  characterCards: `${STORYBOARD_RELATIVE_PATHS.characterDirectory}/*${STORYBOARD_FILE_EXTENSIONS.card}`,
  backgroundCards: `${STORYBOARD_RELATIVE_PATHS.backgroundDirectory}/*${STORYBOARD_FILE_EXTENSIONS.card}`,
  sceneCards: `${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/*${STORYBOARD_FILE_EXTENSIONS.card}`,
  draftMarkdown: `${STORYBOARD_RELATIVE_PATHS.draftDirectory}/**/*${STORYBOARD_FILE_EXTENSIONS.draft}`,
  // 문서 선택자는 워크스페이스 어디에 있는 draft 폴더든 잡아야 한다.
  anyDraftMarkdown: `**/${STORYBOARD_RELATIVE_PATHS.draftDirectory}/*${STORYBOARD_FILE_EXTENSIONS.draft}`,
} as const;

// NOTE: 스레드는 연속성 줄기다. 기본 줄기('main')는 종전 경로를 그대로 쓰고, 나머지 줄기만
// 하위 디렉터리로 갈라 이야기 상태·요약·인물 기억이 줄기 밖으로 새지 않게 한다.
export function threadMemoryRelativePath(threadId: string, leafRelativePath: string): string {
  const leaf = leafRelativePath.startsWith(`${STORYBOARD_RELATIVE_PATHS.memoryDirectory}/`)
    ? leafRelativePath.slice(STORYBOARD_RELATIVE_PATHS.memoryDirectory.length + 1)
    : leafRelativePath;

  return `${STORYBOARD_RELATIVE_PATHS.threadMemoryDirectory}/${threadId}/${leaf}`;
}

export function characterCardRelativePath(id: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.characterDirectory}/${id}${STORYBOARD_FILE_EXTENSIONS.card}`;
}

export function characterProfileRelativePath(id: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.characterProfileDirectory}/${id}${STORYBOARD_FILE_EXTENSIONS.profileImage}`;
}

export function backgroundCardRelativePath(id: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.backgroundDirectory}/${id}${STORYBOARD_FILE_EXTENSIONS.card}`;
}

export function narratorCardRelativePath(id: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.narratorDirectory}/${id}${STORYBOARD_FILE_EXTENSIONS.card}`;
}

export function sceneRelativePath(sceneStem: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/${sceneStem}${STORYBOARD_FILE_EXTENSIONS.card}`;
}

export function sceneFileRelativePath(prefix: string, slug: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/${prefix}-${slug}${STORYBOARD_FILE_EXTENSIONS.card}`;
}

export function draftRelativePath(sceneStem: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.draftDirectory}/${sceneStem}${STORYBOARD_FILE_EXTENSIONS.draft}`;
}

export function draftHistorySceneRelativeDirectory(sceneStem: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.draftHistoryDirectory}/${sceneStem}`;
}

export function isHiddenSceneFileName(fileName: string): boolean {
  return fileName.startsWith('.') && fileName.endsWith(STORYBOARD_FILE_EXTENSIONS.card);
}

export function parseCardIdFromFileName(fileName: string): string | undefined {
  if (!fileName.endsWith(STORYBOARD_FILE_EXTENSIONS.card)) {
    return undefined;
  }

  return fileName.slice(0, -STORYBOARD_FILE_EXTENSIONS.card.length);
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
  return isDirectChildWithExtension(relativePath, STORYBOARD_RELATIVE_PATHS.draftDirectory, STORYBOARD_FILE_EXTENSIONS.draft);
}

export function isDirectSceneCardRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, STORYBOARD_RELATIVE_PATHS.sceneDirectory, STORYBOARD_FILE_EXTENSIONS.card);
}

export function isDirectCharacterCardRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, STORYBOARD_RELATIVE_PATHS.characterDirectory, STORYBOARD_FILE_EXTENSIONS.card);
}

export function isDirectBackgroundCardRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, STORYBOARD_RELATIVE_PATHS.backgroundDirectory, STORYBOARD_FILE_EXTENSIONS.card);
}

export function isDirectNarratorCardRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, STORYBOARD_RELATIVE_PATHS.narratorDirectory, STORYBOARD_FILE_EXTENSIONS.card);
}

// 마이그레이션 전용: 구형 씬 텍스트(.txt)를 찾아 변환 대상으로 보고할 때만 쓴다.
export function isLegacySceneTextRelativePath(relativePath: string): boolean {
  return isDirectChildWithExtension(relativePath, STORYBOARD_RELATIVE_PATHS.sceneDirectory, STORYBOARD_FILE_EXTENSIONS.legacyScene);
}
