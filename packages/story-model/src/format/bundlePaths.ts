import { isElementSlug } from '#model/element/elementId';
import type { ElementKind } from '#model/element/elementKind';
import { isSceneSlug } from '#model/element/scene';
import { STORYBOARD_FILE_EXTENSIONS, STORYBOARD_RELATIVE_PATHS } from '#model/format/paths';

export type BundleFileRole =
  | 'card'
  | 'statements'
  | 'beats'
  | 'dialogue'
  | 'state'
  | 'summary'
  | 'profileImage'
  | 'placeImage';

export const bundleFileNames: Record<BundleFileRole, string> = {
  card: 'card.yaml',
  statements: 'statements.yaml',
  beats: 'beats.yaml',
  dialogue: 'dialogue.json',
  state: 'state.yaml',
  summary: 'summary.md',
  profileImage: 'profile.png',
  placeImage: 'image.png',
};

export const bundleFileRolesByKind: Record<ElementKind, readonly BundleFileRole[]> = {
  character: ['card', 'statements', 'profileImage'],
  background: ['card', 'statements', 'placeImage'],
  narrator: ['card', 'statements'],
  scene: ['card', 'statements', 'beats', 'dialogue', 'state', 'summary'],
};

export const bundleMemoryDirectoryName: string = 'memory';

export const bundleMemoryFileExtension: string = '.yaml';

export const elementKindsWithMemory: readonly ElementKind[] = ['character', 'background'];

export const elementKindDirectories: Record<ElementKind, string> = {
  character: STORYBOARD_RELATIVE_PATHS.characterDirectory,
  background: STORYBOARD_RELATIVE_PATHS.backgroundDirectory,
  narrator: STORYBOARD_RELATIVE_PATHS.narratorDirectory,
  scene: STORYBOARD_RELATIVE_PATHS.sceneDirectory,
};

export const sceneNumberDigits: number = 3;

export const maxSceneNumber: number = 999;

const numberedSceneStemPattern: RegExp = /^(\d{3})-([a-z0-9][a-z0-9-]*)$/;

export type BundlePathErrorCode = 'scene-number-out-of-range' | 'invalid-slug';

export class BundlePathError extends Error {
  public constructor(
    public readonly code: BundlePathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BundlePathError';
  }
}

export interface NumberedSceneStem {
  readonly number: number;
  readonly slug: string;
}

export interface BundleDirectoryNameParts {
  readonly slug: string;
  readonly sceneNumber?: number;
}

export function isSceneNumberInRange(sceneNumber: number): boolean {
  return Number.isInteger(sceneNumber) && sceneNumber >= 1 && sceneNumber <= maxSceneNumber;
}

export function formatSceneNumber(sceneNumber: number): string {
  if (!isSceneNumberInRange(sceneNumber)) {
    throw new BundlePathError(
      'scene-number-out-of-range',
      `씬 번호는 1 부터 ${maxSceneNumber} 까지입니다: ${sceneNumber}`,
    );
  }

  return String(sceneNumber).padStart(sceneNumberDigits, '0');
}

export function formatNumberedSceneStem(sceneNumber: number, slug: string): string {
  return `${formatSceneNumber(sceneNumber)}-${slug}`;
}

export function parseNumberedSceneStem(stem: string): NumberedSceneStem | undefined {
  const match: RegExpExecArray | null = numberedSceneStemPattern.exec(stem);
  const numberText: string | undefined = match?.[1];
  const slug: string | undefined = match?.[2];
  if (numberText === undefined || slug === undefined) {
    return undefined;
  }

  const sceneNumber: number = Number(numberText);

  return isSceneNumberInRange(sceneNumber) && isSceneSlug(slug)
    ? { number: sceneNumber, slug }
    : undefined;
}

function requireSlug(kind: ElementKind, slug: string): string {
  const isValidSlug: boolean = isElementSlug(slug) && (kind !== 'scene' || isSceneSlug(slug));
  if (!isValidSlug) {
    throw new BundlePathError('invalid-slug', `${kind} 번들에 쓸 수 없는 slug 입니다: ${slug}`);
  }

  return slug;
}

export function formatBundleDirectoryName(
  kind: ElementKind,
  parts: BundleDirectoryNameParts,
): string {
  const slug: string = requireSlug(kind, parts.slug);
  const stem: string =
    kind === 'scene' ? formatNumberedSceneStem(parts.sceneNumber ?? 0, slug) : slug;

  return `${stem}${STORYBOARD_FILE_EXTENSIONS.card}`;
}

export function parseBundleDirectoryName(
  kind: ElementKind,
  directoryName: string,
): BundleDirectoryNameParts | undefined {
  if (!directoryName.endsWith(STORYBOARD_FILE_EXTENSIONS.card)) {
    return undefined;
  }

  const stem: string = directoryName.slice(0, -STORYBOARD_FILE_EXTENSIONS.card.length);
  if (kind !== 'scene') {
    return isElementSlug(stem) ? { slug: stem } : undefined;
  }

  const numbered: NumberedSceneStem | undefined = parseNumberedSceneStem(stem);

  return numbered === undefined ? undefined : { slug: numbered.slug, sceneNumber: numbered.number };
}

export function bundleRelativePath(kind: ElementKind, directoryName: string): string {
  return `${elementKindDirectories[kind]}/${directoryName}`;
}

export function bundleFileRelativePath(bundlePath: string, role: BundleFileRole): string {
  return `${bundlePath}/${bundleFileNames[role]}`;
}

export function bundleMemoryRelativePath(bundlePath: string, threadId: string): string {
  return `${bundlePath}/${bundleMemoryDirectoryName}/${threadId}${bundleMemoryFileExtension}`;
}

export function numberedDraftRelativePath(sceneStem: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.draftDirectory}/${sceneStem}${STORYBOARD_FILE_EXTENSIONS.draft}`;
}

export function sceneCacheRelativeDirectory(sceneId: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.sceneCacheDirectory}/${sceneId}`;
}

export function draftRevisionRelativeDirectory(sceneId: string): string {
  return `${STORYBOARD_RELATIVE_PATHS.revisionRoundsDirectory}/${sceneId}`;
}

export function isKnownBundleEntry(kind: ElementKind, entryName: string): boolean {
  const isMemoryDirectory: boolean =
    entryName === bundleMemoryDirectoryName && elementKindsWithMemory.includes(kind);

  return (
    isMemoryDirectory ||
    bundleFileRolesByKind[kind].some((role) => bundleFileNames[role] === entryName)
  );
}
