import type { AssembleManuscriptUseCase } from '#engine/application/manuscript/assembleManuscriptUseCase';
import type { SummarizeChaptersUseCase } from '#engine/application/manuscript/summarizeChaptersUseCase';
import { assembleManuscript, flattenChapterPlan, toOutlineBrief } from '@storyboard/story-model';
import { buildManuscriptReviewMarkdown } from '#engine/domain/manuscriptReview';
import { reviewChapterWindows } from '#engine/application/manuscript/reviewChapterWindows';
import { draftPath, scenePath, type StoryboardProjectPaths } from '#engine/paths/projectPaths';
import { recordRevisionEntry } from '#engine/persistence/revisionPlanRecorder';
import { buildSceneSeeds } from '#engine/domain/sceneSeedFactory';
import type { NovelRunState, NovelStageName } from '#engine/domain/files/novelRunState';
import type { StoryUri, ChapterPlan, StoryboardProject } from '@storyboard/story-model';
import type {
  AiProviderRegistry,
  ContinuityIssueLike,
  DraftCritiqueIssue,
} from '@storyboard/story-ai';
import type { ReviseSeedIssues } from '@storyboard/story-pipeline';
import type {
  INovelOutlineRepository,
  INovelReviewRepository,
  ISceneSeedRepository,
} from './novelPipelinePorts';
import type {
  NovelAiService,
  NovelApprovalKind,
  NovelPipelineOptions,
  NovelPipelineResult,
} from './novelPipelineTypes';
import { integerSettingDefault } from '@storyboard/story-ai';

export interface ChapterGroup {
  readonly title: string;
  readonly stems: readonly string[];
}

export async function cancel(
  persist: (patch: Partial<NovelRunState>) => Promise<void>,
): Promise<NovelPipelineResult> {
  await persist({ status: 'paused' });
  return { outcome: 'cancelled', message: '실행을 취소했습니다. 다시 실행하면 이어서 진행합니다.' };
}

async function pause(
  persist: (patch: Partial<NovelRunState>) => Promise<void>,
): Promise<NovelPipelineResult> {
  await persist({ status: 'paused' });
  return {
    outcome: 'paused',
    message: '진행 중이던 씬까지 마치고 멈췄습니다. 다시 실행하면 이어서 진행합니다.',
  };
}

export async function pauseIfRequested(
  options: NovelPipelineOptions,
  persist: (patch: Partial<NovelRunState>) => Promise<void>,
): Promise<NovelPipelineResult | undefined> {
  return options.shouldPause?.() ? await pause(persist) : undefined;
}

interface ApprovalRequest {
  readonly kind: NovelApprovalKind;
  readonly info: string;
  readonly pausedMessage: string;
}

export async function pauseForApproval(
  options: NovelPipelineOptions,
  persist: (patch: Partial<NovelRunState>) => Promise<void>,
  request: ApprovalRequest,
): Promise<NovelPipelineResult | undefined> {
  const approved = await options.requestApproval(request.kind, request.info);
  if (approved) {
    return undefined;
  }
  await persist({ status: 'paused' });
  return { outcome: 'paused', message: request.pausedMessage };
}

export async function runOutlineStage(
  workspaceUri: StoryUri,
  project: StoryboardProject,
  aiService: NovelAiService,
  outlineRepository: INovelOutlineRepository,
): Promise<void> {
  const brief = toOutlineBrief(project);
  const synopsis = await aiService.generateOutlineSynopsis(brief);
  const characters = await outlineRepository.loadCharacterBriefs(workspaceUri);
  const chapterPlan = await aiService.generateChapterPlan(brief, synopsis, characters);

  await outlineRepository.save(workspaceUri, synopsis, chapterPlan);
}

export async function runSeedsStage(
  workspaceUri: StoryUri,
  plan: ChapterPlan,
  digitCount: number,
  sceneSeedRepository: ISceneSeedRepository,
): Promise<void> {
  await sceneSeedRepository.saveSeeds(workspaceUri, buildSceneSeeds(plan, digitCount));
}

async function runChapterDraftsAndRevise(
  group: ChapterGroup,
  paths: StoryboardProjectPaths,
  options: NovelPipelineOptions,
): Promise<'finished' | 'paused'> {
  for (const stem of group.stems) {
    if (options.shouldCancel()) {
      return 'finished';
    }

    if (options.shouldPause?.()) {
      return 'paused';
    }

    const sceneUri = scenePath(options.workspaceUri, stem);
    const draftResult = await options.deps.generateDraftUseCase.execute({
      sceneUri,
      force: false,
      suppressLoggerPanel: true,
      shouldCancel: options.shouldCancel,
    });

    if (!draftResult.ok) {
      if (draftResult.kind === 'cancelled') {
        return 'finished';
      }
      throw new Error(`초안 생성 실패(${stem}): ${draftResult.message}`);
    }

    const reviseResult = await options.deps.reviseDraftUseCase.execute({
      workspaceUri: options.workspaceUri,
      paths,
      draftUri: draftPath(options.workspaceUri, stem),
      sceneStem: stem,
      maxIterations: options.reviseMaxIterations,
      maxCompressionPercent: options.deps.configBridge.getMaxCompressionPercent?.() ?? integerSettingDefault('revise.length.maxCompressionPercent'),
      reviseScoreThreshold: 0,
      shouldCancel: options.shouldCancel,
    });

    await recordRevisionEntry(options.deps.fileSystem, paths, {
      sceneStem: stem,
      checkedAt: new Date().toISOString(),
      revisionCount: reviseResult.revisionCount,
      remainingBlocking: reviseResult.remainingBlocking,
      instructions: reviseResult.instructions,
      preservedOriginal: reviseResult.preservedOriginal,
      rejection: reviseResult.rejection,
    });
  }

  return 'finished';
}

interface ChapterStageContext {
  readonly options: NovelPipelineOptions;
  readonly paths: StoryboardProjectPaths;
  readonly groups: readonly ChapterGroup[];
  readonly state: NovelRunState;
  readonly completed: Set<NovelStageName>;
  readonly persist: (patch: Partial<NovelRunState>) => Promise<void>;
}

export async function runChapterStages(
  ctx: ChapterStageContext,
): Promise<NovelPipelineResult | undefined> {
  const { options, paths, groups, state, completed, persist } = ctx;
  if (completed.has('chapters')) {
    return undefined;
  }

  for (let chapterIndex = state.nextChapterIndex; chapterIndex < groups.length; chapterIndex += 1) {
    const group = groups[chapterIndex];
    if (!group) {
      continue;
    }
    options.onProgress(
      'chapters',
      `${chapterIndex + 1}/${groups.length}장 «${group.title}» 초안·검수 중…`,
    );

    // NOTE: 장 도중에 멈추면 nextChapterIndex 를 올리지 않는다. 재개가 같은 장을 다시 돌면 끝난 씬은
    // 캐시로 건너뛰고 남은 씬부터 이어 쓴다.
    if ((await runChapterDraftsAndRevise(group, paths, options)) === 'paused') {
      return await pause(persist);
    }

    await refreshChapterSummary(options, chapterIndex);

    await persist({ nextChapterIndex: chapterIndex + 1 });

    if (options.shouldCancel()) {
      return await cancel(persist);
    }

    const pausedAfterChapter = await pauseIfRequested(options, persist);
    if (pausedAfterChapter) {
      return pausedAfterChapter;
    }

    const isLastChapter = chapterIndex === groups.length - 1;
    if (options.runMode === 'chapter-approval' && !isLastChapter) {
      const paused = await pauseForApproval(options, persist, {
        kind: 'chapter',
        info: `${chapterIndex + 1}장을 마쳤습니다. 다음 장으로 진행할까요?`,
        pausedMessage: `${chapterIndex + 1}장까지 진행하고 멈췄습니다.`,
      });
      if (paused) {
        return paused;
      }
    }
  }

  completed.add('chapters');
  await persist({});
  return undefined;
}

// The rolling summary is what a later chapter reads as "the story so far", so it is refreshed as
// each chapter lands rather than only at the end of the run. A failure here costs the next chapter
// its recap, not the run, so it is reported and the pipeline continues.
async function refreshChapterSummary(
  options: NovelPipelineOptions,
  chapterIndex: number,
): Promise<void> {
  const result = await options.deps.summarizeChaptersUseCase.execute({
    workspaceRoot: options.workspaceUri,
    chapterIndex,
  });

  if (!result.ok) {
    options.onProgress(
      'chapters',
      `${chapterIndex + 1}장 요약을 갱신하지 못했습니다. 다음 장은 이전 요약으로 진행합니다.`,
    );
  }
}

export async function runAssembleStage(
  workspaceUri: StoryUri,
  assembleManuscriptUseCase: AssembleManuscriptUseCase,
): Promise<void> {
  const result = await assembleManuscriptUseCase.execute({ workspaceRoot: workspaceUri });
  if (!result.ok) {
    throw new Error(
      result.kind === 'failed' ? result.message : `원고를 조립할 수 없습니다: ${result.kind}`,
    );
  }
}

export interface ReviewStageResult {
  // Scenes with at least one high-severity finding, each with the issues to answer.
  readonly targets: readonly ReviewTarget[];
  readonly highCount: number;
}

export interface ReviewTarget {
  readonly sceneStem: string;
  readonly seedIssues: ReviseSeedIssues;
}

export async function runReviewStage(
  workspaceUri: StoryUri,
  project: StoryboardProject,
  plan: ChapterPlan,
  aiService: NovelAiService,
  registry: AiProviderRegistry,
  reviewRepository: INovelReviewRepository,
  revisedStems: readonly string[] = [],
): Promise<ReviewStageResult> {
  const { draftsByOrder, canonFactLines, chapterSummaries } =
    await reviewRepository.loadReviewSource(workspaceUri);
  const manuscript = assembleManuscript({
    plan,
    projectName: project.name,
    draftsByOrder,
    annotateSceneStems: true,
  });
  const characters = collectCharacterIds(plan);

  const { continuityIssues, critiqueIssues } = await reviewChapterWindows({
    aiService,
    manuscript,
    storySoFar: chapterSummaries,
    canonFactLines,
    characters,
    styleConstraints: project.setting?.styleConstraints ?? [],
    qualityCriteria: project.setting?.qualityCriteria ?? [],
    hasSceneMarkers: true,
    continuityProviderId: registry.getTaskProvider('continuityCheck'),
    critiqueProviderId: registry.getTaskProvider('draftCritique'),
  });

  const knownStems = new Set([...draftsByOrder.values()].map((draft) => draft.stem));
  const targets = groupHighIssuesByScene(continuityIssues, critiqueIssues, knownStems);

  const reportMarkdown = buildManuscriptReviewMarkdown({
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

// An issue can only be rewritten if the review named a scene that actually has a draft. The rest
// stay in the report — silently dropping them would read as "nothing to fix".
function groupHighIssuesByScene(
  continuityIssues: readonly ContinuityIssueLike[],
  critiqueIssues: readonly DraftCritiqueIssue[],
  knownStems: ReadonlySet<string>,
): ReviewTarget[] {
  const byStem = new Map<
    string,
    { continuity: ContinuityIssueLike[]; critique: DraftCritiqueIssue[] }
  >();

  const bucketFor = (
    sceneStem: string | undefined,
  ): { continuity: ContinuityIssueLike[]; critique: DraftCritiqueIssue[] } | undefined => {
    if (sceneStem === undefined || !knownStems.has(sceneStem)) {
      return undefined;
    }

    const existing = byStem.get(sceneStem);
    if (existing) {
      return existing;
    }

    const created = {
      continuity: [] as ContinuityIssueLike[],
      critique: [] as DraftCritiqueIssue[],
    };
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

// One rewrite pass per named scene, carrying the volume-level findings a per-scene check could not
// have seen. The caller reviews once more afterwards so the report reflects the rewritten text.
export async function runReviseFromReviewStage(
  options: NovelPipelineOptions,
  paths: StoryboardProjectPaths,
  targets: readonly ReviewTarget[],
): Promise<string[]> {
  const revisedStems: string[] = [];

  for (const target of targets) {
    if (options.shouldCancel()) {
      return revisedStems;
    }

    options.onProgress('revise-from-review', `«${target.sceneStem}» 재작성 중…`);

    const result = await options.deps.reviseDraftUseCase.execute({
      workspaceUri: options.workspaceUri,
      paths,
      draftUri: draftPath(options.workspaceUri, target.sceneStem),
      sceneStem: target.sceneStem,
      maxIterations: 1,
      maxCompressionPercent: options.deps.configBridge.getMaxCompressionPercent?.() ?? integerSettingDefault('revise.length.maxCompressionPercent'),
      reviseScoreThreshold: 0,
      seedIssues: target.seedIssues,
      shouldCancel: options.shouldCancel,
    });

    if (result.revisionCount > 0) {
      revisedStems.push(target.sceneStem);
    }

    await recordRevisionEntry(options.deps.fileSystem, paths, {
      sceneStem: target.sceneStem,
      checkedAt: new Date().toISOString(),
      revisionCount: result.revisionCount,
      remainingBlocking: result.remainingBlocking,
      instructions: result.instructions,
      preservedOriginal: result.preservedOriginal,
      rejection: result.rejection,
    });
  }

  return revisedStems;
}

export async function runSummariesStage(
  workspaceUri: StoryUri,
  summarizeChaptersUseCase: SummarizeChaptersUseCase,
): Promise<void> {
  const result = await summarizeChaptersUseCase.execute({ workspaceRoot: workspaceUri });
  if (!result.ok) {
    throw new Error(
      result.kind === 'failed' ? result.message : `장별 요약을 완료할 수 없습니다: ${result.kind}`,
    );
  }
}

export function groupChapterStems(plan: ChapterPlan, digitCount: number): ChapterGroup[] {
  const seeds = buildSceneSeeds(plan, digitCount);
  const flat = flattenChapterPlan(plan);
  const groups: { title: string; stems: string[]; actIndex: number; chapterIndex: number }[] = [];

  flat.forEach((flatScene, index) => {
    const stem = seeds[index]?.stem;
    if (stem === undefined) {
      return;
    }

    const last = groups.at(-1);
    if (
      last &&
      last.actIndex === flatScene.actIndex &&
      last.chapterIndex === flatScene.chapterIndex
    ) {
      last.stems.push(stem);
      return;
    }
    groups.push({
      title: flatScene.chapterTitle,
      stems: [stem],
      actIndex: flatScene.actIndex,
      chapterIndex: flatScene.chapterIndex,
    });
  });

  return groups.map(({ title, stems }) => ({ title, stems }));
}

function collectCharacterIds(plan: ChapterPlan): string[] {
  const ids = new Set<string>();
  for (const flatScene of flattenChapterPlan(plan)) {
    for (const id of flatScene.scene.characters) {
      ids.add(id);
    }
  }
  return [...ids];
}
