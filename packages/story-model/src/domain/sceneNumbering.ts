import {
  bundleRelativePath,
  formatBundleDirectoryName,
  formatNumberedSceneStem,
  numberedDraftRelativePath,
  parseBundleDirectoryName,
  type BundleDirectoryNameParts,
} from '#model/format/bundlePaths';
import { STORYBOARD_FILE_EXTENSIONS, STORYBOARD_RELATIVE_PATHS } from '#model/format/paths';
import type { StoryStructure } from '#model/format/structure';

export interface SceneBundleOnDisk {
  readonly sceneId: string;
  readonly slug: string;
  readonly directoryName: string;
  readonly hasDraft: boolean;
}

export type SceneRenameTarget = 'bundle' | 'draft';

export interface SceneRenameStep {
  readonly sceneId: string;
  readonly target: SceneRenameTarget;
  readonly from: string;
  readonly to: string;
}

export interface SceneRenamePlan {
  readonly steps: readonly SceneRenameStep[];
  readonly unplacedSceneIds: readonly string[];
  readonly missingSceneIds: readonly string[];
}

interface SceneMove {
  readonly bundle: SceneBundleOnDisk;
  readonly currentStem: string;
  readonly expectedStem: string;
}

const renamingPrefix: string = '.renaming-';

export function deriveSceneNumber(structure: StoryStructure, sceneId: string): number | undefined {
  const index: number = structure.scenes.findIndex((entry) => entry.scene === sceneId);

  return index === -1 ? undefined : index + 1;
}

export function deriveSceneStem(
  structure: StoryStructure,
  sceneId: string,
  slug: string,
): string | undefined {
  const sceneNumber: number | undefined = deriveSceneNumber(structure, sceneId);

  return sceneNumber === undefined ? undefined : formatNumberedSceneStem(sceneNumber, slug);
}

function currentStemOf(bundle: SceneBundleOnDisk): string | undefined {
  const parts: BundleDirectoryNameParts | undefined = parseBundleDirectoryName(
    'scene',
    bundle.directoryName,
  );

  return parts?.sceneNumber === undefined
    ? undefined
    : formatNumberedSceneStem(parts.sceneNumber, parts.slug);
}

function listSceneMoves(
  structure: StoryStructure,
  bundles: readonly SceneBundleOnDisk[],
): readonly SceneMove[] {
  return bundles.flatMap((bundle): SceneMove[] => {
    const expectedStem: string | undefined = deriveSceneStem(
      structure,
      bundle.sceneId,
      bundle.slug,
    );
    const currentStem: string = currentStemOf(bundle) ?? bundle.directoryName;

    return expectedStem === undefined || expectedStem === currentStem
      ? []
      : [{ bundle, currentStem, expectedStem }];
  });
}

function bundlePathOfStem(stem: string): string {
  return bundleRelativePath('scene', `${stem}${STORYBOARD_FILE_EXTENSIONS.card}`);
}

function holdingPaths(sceneId: string): Record<SceneRenameTarget, string> {
  return {
    bundle: bundleRelativePath(
      'scene',
      `${renamingPrefix}${sceneId}${STORYBOARD_FILE_EXTENSIONS.card}`,
    ),
    draft: `${STORYBOARD_RELATIVE_PATHS.draftDirectory}/${renamingPrefix}${sceneId}${STORYBOARD_FILE_EXTENSIONS.draft}`,
  };
}

function stepsBetween(
  move: SceneMove,
  from: Record<SceneRenameTarget, string>,
  to: Record<SceneRenameTarget, string>,
): readonly SceneRenameStep[] {
  const bundleStep: SceneRenameStep = {
    sceneId: move.bundle.sceneId,
    target: 'bundle',
    from: from.bundle,
    to: to.bundle,
  };
  const draftStep: SceneRenameStep = {
    sceneId: move.bundle.sceneId,
    target: 'draft',
    from: from.draft,
    to: to.draft,
  };

  return move.bundle.hasDraft ? [bundleStep, draftStep] : [bundleStep];
}

function pathsOfStem(stem: string): Record<SceneRenameTarget, string> {
  return { bundle: bundlePathOfStem(stem), draft: numberedDraftRelativePath(stem) };
}

function hasCollidingTarget(moves: readonly SceneMove[]): boolean {
  const currentStems: ReadonlySet<string> = new Set(moves.map((move) => move.currentStem));

  return moves.some((move) => currentStems.has(move.expectedStem));
}

function planMoveSteps(moves: readonly SceneMove[]): readonly SceneRenameStep[] {
  if (!hasCollidingTarget(moves)) {
    return moves.flatMap((move) =>
      stepsBetween(move, pathsOfStem(move.currentStem), pathsOfStem(move.expectedStem)),
    );
  }

  return [
    ...moves.flatMap((move) =>
      stepsBetween(move, pathsOfStem(move.currentStem), holdingPaths(move.bundle.sceneId)),
    ),
    ...moves.flatMap((move) =>
      stepsBetween(move, holdingPaths(move.bundle.sceneId), pathsOfStem(move.expectedStem)),
    ),
  ];
}

export function planSceneRenames(
  structure: StoryStructure,
  bundles: readonly SceneBundleOnDisk[],
): SceneRenamePlan {
  const placedIds: ReadonlySet<string> = new Set(structure.scenes.map((entry) => entry.scene));
  const bundleIds: ReadonlySet<string> = new Set(bundles.map((bundle) => bundle.sceneId));

  return {
    steps: planMoveSteps(listSceneMoves(structure, bundles)),
    unplacedSceneIds: bundles
      .map((bundle) => bundle.sceneId)
      .filter((sceneId) => !placedIds.has(sceneId)),
    missingSceneIds: structure.scenes
      .map((entry) => entry.scene)
      .filter((sceneId) => !bundleIds.has(sceneId)),
  };
}

export function listMisnumberedScenes(
  structure: StoryStructure,
  bundles: readonly SceneBundleOnDisk[],
): readonly SceneBundleOnDisk[] {
  return listSceneMoves(structure, bundles).map((move) => move.bundle);
}

export function expectedSceneDirectoryName(
  structure: StoryStructure,
  sceneId: string,
  slug: string,
): string | undefined {
  const sceneNumber: number | undefined = deriveSceneNumber(structure, sceneId);

  return sceneNumber === undefined
    ? undefined
    : formatBundleDirectoryName('scene', { slug, sceneNumber });
}

export function isSceneRenameHoldingPath(relativePath: string): boolean {
  return (relativePath.split('/').at(-1) ?? relativePath).startsWith(renamingPrefix);
}
