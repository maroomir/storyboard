import {
  loadNarratorCards,
  manuscriptReviewFileName,
  type IFileSystem,
} from '@storyboard/story-engine';
import {
  diffCandidatesAgainstCanon,
  getStoryboardProjectPaths,
  joinStoryPath,
  validateGenerationContract,
  type CanonDiffResult,
  type ContractFieldKey,
  type SceneListItem,
  type StoryboardProject,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';

import type { CardManager } from './managers/cardManager';
import type { DraftManager, DraftReading } from './managers/draftManager';
import type { NovelManager } from './managers/novelManager';

export type WorkspaceNextStep =
  | 'fill-contract'
  | 'generate-outline'
  | 'seed-scenes'
  | 'generate-drafts'
  | 'assemble-manuscript'
  | 'review-manuscript'
  | 'none';

export const workspaceNextSteps: readonly WorkspaceNextStep[] = [
  'fill-contract',
  'generate-outline',
  'seed-scenes',
  'generate-drafts',
  'assemble-manuscript',
  'review-manuscript',
  'none',
];

export interface WorkspaceOutlineStatus {
  readonly hasSynopsis: boolean;
  readonly hasChapterPlan: boolean;
}

export interface WorkspaceDraftCounts {
  readonly ready: number;
  readonly stale: number;
  readonly missing: number;
  readonly withWarnings: number;
}

export interface WorkspaceManuscriptStatus {
  readonly isAssembled: boolean;
  readonly isStale: boolean;
  readonly isReviewed: boolean;
}

export interface WorkspaceStatus {
  readonly project: {
    readonly name: string;
    readonly missingContract: readonly ContractFieldKey[];
  };
  readonly outline: WorkspaceOutlineStatus;
  readonly cards: {
    readonly characters: number;
    readonly backgrounds: number;
    readonly narrators: number;
  };
  readonly scenes: { readonly total: number };
  readonly drafts: WorkspaceDraftCounts;
  readonly canon: { readonly pendingFacts: number };
  readonly manuscript: WorkspaceManuscriptStatus;
  readonly nextStep: WorkspaceNextStep;
}

export interface DescribeWorkspaceStatusInput {
  readonly workspaceRoot: StoryUri;
  readonly fileSystem: IFileSystem;
  readonly drafts: DraftManager;
  readonly cards: CardManager;
  readonly novel: NovelManager;
}

export async function describeWorkspaceStatus(
  input: DescribeWorkspaceStatusInput,
): Promise<WorkspaceStatus> {
  const { workspaceRoot, fileSystem, drafts, cards, novel } = input;
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);

  const project: StoryboardProject = await novel.readProject(workspaceRoot);
  const missingContract: ContractFieldKey[] = validateGenerationContract(project.setting).missing;
  const outline: WorkspaceOutlineStatus = {
    hasSynopsis: await fileSystem.exists(paths.outlineSynopsis),
    hasChapterPlan: await fileSystem.exists(paths.outlineChapters),
  };

  const scenes: SceneListItem[] = await drafts.listScenes(workspaceRoot);
  const draftCounts: WorkspaceDraftCounts = {
    ready: countByStatus(scenes, 'ready'),
    stale: countByStatus(scenes, 'stale'),
    missing: countByStatus(scenes, 'missing'),
    withWarnings: await countDraftsWithWarnings(drafts, workspaceRoot, scenes),
  };

  const manuscriptModifiedAt: number = await fileSystem.modifiedTime(paths.manuscriptVolume);
  const newestDraftModifiedAt: number = Math.max(
    0,
    ...scenes.map((scene) => scene.draftMtime ?? 0),
  );
  const manuscript: WorkspaceManuscriptStatus = {
    isAssembled: manuscriptModifiedAt > 0,
    isStale: manuscriptModifiedAt > 0 && manuscriptModifiedAt < newestDraftModifiedAt,
    isReviewed: await fileSystem.exists(
      joinStoryPath(paths.manuscriptDirectory, manuscriptReviewFileName),
    ),
  };

  const canonDiff: CanonDiffResult = diffCandidatesAgainstCanon(
    await cards.bibleCandidates.loadCanon(workspaceRoot),
    await cards.bibleCandidates.loadRecords(workspaceRoot),
  );

  return {
    project: { name: project.name, missingContract },
    outline,
    cards: {
      characters: (await cards.list(workspaceRoot, 'character')).length,
      backgrounds: (await cards.list(workspaceRoot, 'background')).length,
      narrators: (await loadNarratorCards(paths, fileSystem)).size,
    },
    scenes: { total: scenes.length },
    drafts: draftCounts,
    canon: { pendingFacts: canonDiff.pending.length },
    manuscript,
    nextStep: chooseNextStep({
      hasMissingContract: missingContract.length > 0,
      hasChapterPlan: outline.hasChapterPlan,
      sceneCount: scenes.length,
      draftsToWrite: draftCounts.missing + draftCounts.stale,
      manuscript,
    }),
  };
}

function countByStatus(scenes: readonly SceneListItem[], status: SceneListItem['status']): number {
  return scenes.filter((scene) => scene.status === status).length;
}

async function countDraftsWithWarnings(
  drafts: DraftManager,
  workspaceRoot: StoryUri,
  scenes: readonly SceneListItem[],
): Promise<number> {
  let count: number = 0;

  for (const scene of scenes) {
    if (scene.status === 'missing') {
      continue;
    }

    try {
      const reading: DraftReading | undefined = await drafts.readDraft(workspaceRoot, scene.stem);
      count += (reading?.draft.warnings?.length ?? 0) > 0 ? 1 : 0;
    } catch {
      continue;
    }
  }

  return count;
}

interface NextStepFacts {
  readonly hasMissingContract: boolean;
  readonly hasChapterPlan: boolean;
  readonly sceneCount: number;
  readonly draftsToWrite: number;
  readonly manuscript: WorkspaceStatus['manuscript'];
}

function chooseNextStep(facts: NextStepFacts): WorkspaceNextStep {
  if (facts.sceneCount === 0) {
    if (facts.hasMissingContract) {
      return 'fill-contract';
    }

    return facts.hasChapterPlan ? 'seed-scenes' : 'generate-outline';
  }

  if (facts.draftsToWrite > 0) {
    return 'generate-drafts';
  }

  if (!facts.manuscript.isAssembled || facts.manuscript.isStale) {
    return 'assemble-manuscript';
  }

  return facts.manuscript.isReviewed ? 'none' : 'review-manuscript';
}
