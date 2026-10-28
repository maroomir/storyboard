import {
  assembleManuscript,
  buildManuscriptReviewMarkdown,
  collectChapterPlanCharacterIds,
} from '@storyboard/story-model';
import type {
  AssembledManuscript,
  ChapterPlan,
  ContinuityIssueLike,
  DraftCritiqueIssue,
} from '@storyboard/story-model';
import { reviewChapterWindows } from '#engine/application/manuscript/reviewChapterWindows';
import type { INovelReviewRepository } from '#engine/application/novel/novelPipelinePorts';
import type { NovelRun } from '#engine/application/novel/novelRun';
import type { ReviseSeedIssues } from '#engine/pipeline/reviseLoop';

export interface ReviewStageResult {
  readonly targets: readonly ReviewTarget[];
  readonly highCount: number;
}

export interface ReviewTarget {
  readonly sceneStem: string;
  readonly seedIssues: ReviseSeedIssues;
}

interface SceneReviewIssues {
  continuity: ContinuityIssueLike[];
  critique: DraftCritiqueIssue[];
}

function groupHighIssuesByScene(
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[],
  knownStems: ReadonlySet<string>,
): ReviewTarget[] {
  const byStem: Map<string, SceneReviewIssues> = new Map<string, SceneReviewIssues>();

  const bucketFor = (sceneStem: string | undefined): SceneReviewIssues | undefined => {
    if (sceneStem === undefined || !knownStems.has(sceneStem)) {
      return undefined;
    }

    const existing: SceneReviewIssues | undefined = byStem.get(sceneStem);
    if (existing) {
      return existing;
    }

    const created: SceneReviewIssues = { continuity: [], critique: [] };
    byStem.set(sceneStem, created);
    return created;
  };

  for (const issue of continuityIssues) {
    if (issue.severity !== 'high') {
      continue;
    }
    bucketFor(issue.sceneStem)?.continuity.push(issue);
  }

  for (const issue of critiqueIssues) {
    if (issue.severity !== 'high') {
      continue;
    }
    bucketFor(issue.sceneStem)?.critique.push(issue);
  }

  return [...byStem.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sceneStem, issues]) => ({
      sceneStem,
      seedIssues: { continuityIssues: issues.continuity, critiqueIssues: issues.critique },
    }));
}

function countUnroutedHighIssues(
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[],
  knownStems: ReadonlySet<string>,
): number {
  const isUnrouted = (sceneStem: string | undefined): boolean =>
    sceneStem === undefined || !knownStems.has(sceneStem);

  return (
    continuityIssues.filter((issue) => issue.severity === 'high' && isUnrouted(issue.sceneStem))
      .length +
    critiqueIssues.filter((issue) => issue.severity === 'high' && isUnrouted(issue.sceneStem))
      .length
  );
}

export class VolumeReviewer {
  public constructor(private readonly run: NovelRun) {}

  public async review(revisedStems: readonly string[] = []): Promise<ReviewStageResult> {
    const { run } = this;
    const { workspaceUri, project } = run.options;
    const plan: ChapterPlan = await run.chapterPlan();
    const { providerRegistry } = run.services.ai;
    const reviewRepository: INovelReviewRepository = run.services.repositories.novelReviews;
    const { draftsByOrder, canonFactLines, chapterSummaries } =
      await reviewRepository.loadReviewSource(workspaceUri);
    const manuscript: AssembledManuscript = assembleManuscript({
      plan,
      projectName: project.name,
      draftsByOrder,
      annotateSceneStems: true,
    });
    const characters: string[] = collectChapterPlanCharacterIds(plan);

    const { continuityIssues, critiqueIssues } = await reviewChapterWindows({
      aiService: run.newAiService(),
      manuscript,
      storySoFar: chapterSummaries,
      canonFactLines,
      characters,
      styleConstraints: project.setting?.styleConstraints ?? [],
      qualityCriteria: project.setting?.qualityCriteria ?? [],
      hasSceneMarkers: true,
      continuityProviderId: providerRegistry.getTaskProvider('continuityCheck'),
      critiqueProviderId: providerRegistry.getTaskProvider('draftCritique'),
    });

    const knownStems: Set<string> = new Set([...draftsByOrder.values()].map((draft) => draft.stem));
    const targets: ReviewTarget[] = groupHighIssuesByScene(
      continuityIssues,
      critiqueIssues,
      knownStems,
    );

    const reportMarkdown: string = buildManuscriptReviewMarkdown({
      projectName: project.name,
      sceneCount: manuscript.includedCount,
      generatedAt: new Date().toISOString(),
      continuityIssues,
      critiqueIssues,
      revisedStems,
      unroutedHighCount: countUnroutedHighIssues(continuityIssues, critiqueIssues, knownStems),
    });

    await reviewRepository.saveReview(workspaceUri, reportMarkdown);

    return {
      targets,
      highCount:
        continuityIssues.filter((issue) => issue.severity === 'high').length +
        critiqueIssues.filter((issue) => issue.severity === 'high').length,
    };
  }
}
