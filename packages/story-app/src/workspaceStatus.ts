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
  type ContractFieldKey,
  type SceneListItem,
  type StoryUri,
} from '@storyboard/story-model';

import type { CardManager } from './managers/cardManager';
import type { DraftManager } from './managers/draftManager';
import type { NovelManager } from './managers/novelManager';

// What the work needs next, in the order a novel is made. A host turns the kind into its own
// command or button; the engine side only says which step is open.
export const workspaceNextSteps = [
  'fill-contract',
  'generate-outline',
  'seed-scenes',
  'generate-drafts',
  'assemble-manuscript',
  'review-manuscript',
  'none',
] as const;

export type WorkspaceNextStep = (typeof workspaceNextSteps)[number];

export interface WorkspaceStatus {
  readonly project: {
    readonly name: string;
    readonly missingContract: readonly ContractFieldKey[];
  };
  readonly outline: { readonly hasSynopsis: boolean; readonly hasChapterPlan: boolean };
  readonly cards: {
    readonly characters: number;
    readonly backgrounds: number;
    readonly narrators: number;
  };
  readonly scenes: { readonly total: number };
  // `stale` is a draft older than its scene card; `withWarnings` counts drafts whose header still
  // carries a violation the generation could not fix.
  readonly drafts: {
    readonly ready: number;
    readonly stale: number;
    readonly missing: number;
    readonly withWarnings: number;
  };
  readonly canon: { readonly pendingFacts: number };
  // `isStale` is a volume older than the newest draft.
  readonly manuscript: {
    readonly isAssembled: boolean;
    readonly isStale: boolean;
    readonly isReviewed: boolean;
  };
  readonly nextStep: WorkspaceNextStep;
}

export interface DescribeWorkspaceStatusInput {
  readonly workspaceRoot: StoryUri;
  readonly fileSystem: IFileSystem;
  readonly drafts: DraftManager;
  readonly cards: CardManager;
  readonly novel: NovelManager;
}

// Read-only: one pass over the workspace that every host's overview (the CLI's `status`, a home
// screen) can show without knowing the file layout.
export async function describeWorkspaceStatus(
  input: DescribeWorkspaceStatusInput,
): Promise<WorkspaceStatus> {
  const { workspaceRoot, fileSystem, drafts, cards, novel } = input;
  const paths = getStoryboardProjectPaths(workspaceRoot);

  const project = await novel.readProject(workspaceRoot);
  const missingContract = validateGenerationContract(project.setting).missing;
  const outline = {
    hasSynopsis: await fileSystem.exists(paths.outlineSynopsis),
    hasChapterPlan: await fileSystem.exists(paths.outlineChapters),
  };

  const scenes = await drafts.listScenes(workspaceRoot);
  const draftCounts = {
    ready: countByStatus(scenes, 'ready'),
    stale: countByStatus(scenes, 'stale'),
    missing: countByStatus(scenes, 'missing'),
    withWarnings: await countDraftsWithWarnings(drafts, workspaceRoot, scenes),
  };

  const manuscriptModifiedAt = await fileSystem.modifiedTime(paths.manuscriptVolume);
  const newestDraftModifiedAt = Math.max(0, ...scenes.map((scene) => scene.draftMtime ?? 0));
  const manuscript = {
    isAssembled: manuscriptModifiedAt > 0,
    isStale: manuscriptModifiedAt > 0 && manuscriptModifiedAt < newestDraftModifiedAt,
    isReviewed: await fileSystem.exists(
      joinStoryPath(paths.manuscriptDirectory, manuscriptReviewFileName),
    ),
  };

  const canonDiff = diffCandidatesAgainstCanon(
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
  let count = 0;

  for (const scene of scenes) {
    if (scene.status === 'missing') {
      continue;
    }

    try {
      const reading = await drafts.readDraft(workspaceRoot, scene.stem);
      count += (reading?.draft.warnings?.length ?? 0) > 0 ? 1 : 0;
    } catch {
      // NOTE: 손으로 고치다 깨진 초안 하나가 현황 전체를 막으면 안 된다. 경고 수에서만 빠진다.
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
  // 씬 카드를 손으로 쓰거나 노트에서 가져온 작품은 계약·아웃라인 없이도 초안으로 갈 수 있다.
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
