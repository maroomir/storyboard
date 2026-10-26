import type {
  AssembleManuscriptResult,
  AssembleManuscriptUseCase,
} from '#engine/application/manuscript/assembleManuscriptUseCase';
import type {
  SummarizeChaptersResult,
  SummarizeChaptersUseCase,
} from '#engine/application/manuscript/summarizeChaptersUseCase';
import {
  assembleManuscript,
  createEmptyCharacter,
  emptyOutlineSynopsis,
  findUncastCharacters,
  flattenChapterPlan,
  toOutlineBrief,
  integerSettingDefault,
  buildManuscriptReviewMarkdown,
  draftPath,
  scenePath,
  type StoryboardProjectPaths,
  buildSceneSeeds,
  collectChapterPlanCharacterIds,
} from '@storyboard/story-model';
import { reviewChapterWindows } from '#engine/application/manuscript/reviewChapterWindows';
import { recordRevisionEntry } from '#engine/persistence/revisionPlanRecorder';
import { refuseChapterCountMismatch } from './chapterPlanContract';
import type {
  NovelRunState,
  NovelStageName,
  StoryUri,
  ChapterPlan,
  StoryboardProject,
  ContinuityIssueLike,
  DraftCritiqueIssue,
  OutlineBrief,
  OutlineSynopsis,
  OutlineCharacterBrief,
  OutlineCharacterDraft,
  AssembledManuscript,
  GeneratedSceneSeed,
  FlatChapterScene,
} from '@storyboard/story-model';
import type { AiProviderRegistry } from '@storyboard/story-ai';
import type { ReviseSeedIssues } from '#engine/pipeline/reviseLoop';
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
import type { GenerateDraftResult } from '#engine/application/drafts/generateDraftTypes';
import type { ReviseDraftWorkflowResult } from '#engine/application/drafts/reviseDraftUseCase';
import type { ICardWriterRepository } from '#engine/application/cards/cardRepositories';

interface SceneReviewIssues {
  continuity: ContinuityIssueLike[];
  critique: DraftCritiqueIssue[];
}

interface ChapterStemGroup {
  title: string;
  stems: string[];
  actIndex: number;
  chapterIndex: number;
}

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
  reason = '진행 중이던 씬까지 마치고 멈췄습니다.',
): Promise<NovelPipelineResult> {
  await persist({ status: 'paused' });
  return { outcome: 'paused', message: `${reason} 다시 실행하면 이어서 진행합니다.` };
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
  const approved: boolean = await options.requestApproval(request.kind, request.info);
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
  const brief: OutlineBrief = toOutlineBrief(project);
  const keptPlan: ChapterPlan | undefined = (await outlineRepository.hasChapterPlan(workspaceUri))
    ? await outlineRepository.loadChapterPlan(workspaceUri)
    : undefined;

  if (keptPlan !== undefined && flattenChapterPlan(keptPlan).length > 0) {
    refuseChapterCountMismatch(brief, keptPlan, 'kept');

    if ((await outlineRepository.loadSynopsis(workspaceUri)) === undefined) {
      await outlineRepository.saveSynopsis(
        workspaceUri,
        await aiService.generateOutlineSynopsis(brief),
      );
    }
    return;
  }

  const synopsis: OutlineSynopsis = await aiService.generateOutlineSynopsis(brief);
  const characters: readonly OutlineCharacterBrief[] =
    await outlineRepository.loadCharacterBriefs(workspaceUri);
  const chapterPlan: ChapterPlan = await aiService.generateChapterPlan(brief, synopsis, characters);
  refuseChapterCountMismatch(brief, chapterPlan, 'generated');

  await outlineRepository.save(workspaceUri, synopsis, chapterPlan);
}

export interface CharactersStageReport {
  readonly writtenCount: number;
  readonly missingIds: readonly string[];
  readonly unusableIds: readonly string[];
}

export async function runCharactersStage(
  workspaceUri: StoryUri,
  project: StoryboardProject,
  plan: ChapterPlan,
  aiService: NovelAiService,
  outlineRepository: INovelOutlineRepository,
  cardWriter: ICardWriterRepository,
): Promise<CharactersStageReport> {
  const existingIds: Set<string> = new Set(
    (await outlineRepository.loadCharacterBriefs(workspaceUri)).map((brief) => brief.id),
  );
  const { cast, unusableIds } = findUncastCharacters(plan, existingIds);

  if (cast.length === 0) {
    return { writtenCount: 0, missingIds: [], unusableIds };
  }

  const synopsis: OutlineSynopsis =
    (await outlineRepository.loadSynopsis(workspaceUri)) ?? emptyOutlineSynopsis();
  const drafts: OutlineCharacterDraft[] = await aiService.generateOutlineCharacters(
    toOutlineBrief(project),
    synopsis,
    cast,
  );
  const draftedIds: Set<string> = new Set(drafts.map((draft) => draft.id));
  const missingIds: string[] = cast.map((member) => member.id).filter((id) => !draftedIds.has(id));

  if (missingIds.length === cast.length) {
    throw new Error(`인물 카드를 하나도 만들지 못했습니다: ${missingIds.join(', ')}`);
  }

  let writtenCount: number = 0;

  for (const draft of drafts) {
    if (await cardWriter.exists(workspaceUri, 'character', draft.id)) {
      continue;
    }

    await cardWriter.write(workspaceUri, {
      ...createEmptyCharacter(draft.id, draft.name),
      ...(draft.role === undefined ? {} : { role: draft.role }),
      description: [...draft.description],
    });
    writtenCount += 1;
  }

  return { writtenCount, missingIds, unusableIds };
}

export async function runSeedsStage(
  workspaceUri: StoryUri,
  plan: ChapterPlan,
  digitCount: number,
  sceneSeedRepository: ISceneSeedRepository,
): Promise<void> {
  await sceneSeedRepository.saveMissingSeeds(workspaceUri, buildSceneSeeds(plan, digitCount));
}

type ChapterDraftsOutcome = 'finished' | 'paused' | { readonly limitReached: string };

async function runChapterDraftsAndRevise(
  group: ChapterGroup,
  paths: StoryboardProjectPaths,
  options: NovelPipelineOptions,
): Promise<ChapterDraftsOutcome> {
  for (const stem of group.stems) {
    if (options.shouldCancel()) {
      return 'finished';
    }

    if (options.shouldPause?.()) {
      return 'paused';
    }

    const sceneUri: StoryUri = scenePath(options.workspaceUri, stem);
    const draftResult: GenerateDraftResult =
      await options.deps.collaborators.generateDraftUseCase.execute({
        sceneUri,
        force: false,
        suppressLoggerPanel: true,
        shouldCancel: options.shouldCancel,
      });

    if (!draftResult.ok) {
      if (draftResult.kind === 'cancelled') {
        return 'finished';
      }
      if (draftResult.reason === 'usage-limit') {
        return { limitReached: draftResult.message };
      }
      throw new Error(`초안 생성 실패(${stem}): ${draftResult.message}`);
    }

    const reviseResult: ReviseDraftWorkflowResult =
      await options.deps.collaborators.reviseDraftUseCase.execute({
        workspaceUri: options.workspaceUri,
        paths,
        draftUri: draftPath(options.workspaceUri, stem),
        sceneStem: stem,
        maxIterations: options.reviseMaxIterations,
        maxCompressionPercent:
          options.deps.host.configBridge.getMaxCompressionPercent?.() ??
          integerSettingDefault('revise.length.maxCompressionPercent'),
        reviseScoreThreshold: 0,
        shouldCancel: options.shouldCancel,
      });

    await recordRevisionEntry(options.deps.host.fileSystem, paths, {
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
  chapterContext: ChapterStageContext,
): Promise<NovelPipelineResult | undefined> {
  const { options, paths, groups, state, completed, persist } = chapterContext;
  if (completed.has('chapters')) {
    return undefined;
  }

  for (
    let chapterIndex: number = state.nextChapterIndex;
    chapterIndex < groups.length;
    chapterIndex += 1
  ) {
    const group: ChapterGroup | undefined = groups[chapterIndex];
    if (!group) {
      continue;
    }
    options.onProgress(
      'chapters',
      `${chapterIndex + 1}/${groups.length}장 «${group.title}» 초안·검수 중…`,
    );

    const draftsOutcome: ChapterDraftsOutcome = await runChapterDraftsAndRevise(
      group,
      paths,
      options,
    );
    if (draftsOutcome === 'paused') {
      return await pause(persist);
    }
    if (draftsOutcome !== 'finished') {
      return await pause(persist, draftsOutcome.limitReached);
    }

    await refreshChapterSummary(options, chapterIndex);

    await persist({ nextChapterIndex: chapterIndex + 1 });

    if (options.shouldCancel()) {
      return await cancel(persist);
    }

    const pausedAfterChapter: NovelPipelineResult | undefined = await pauseIfRequested(
      options,
      persist,
    );
    if (pausedAfterChapter) {
      return pausedAfterChapter;
    }

    const isLastChapter: boolean = chapterIndex === groups.length - 1;
    if (options.runMode === 'chapter-approval' && !isLastChapter) {
      const paused: NovelPipelineResult | undefined = await pauseForApproval(options, persist, {
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

async function refreshChapterSummary(
  options: NovelPipelineOptions,
  chapterIndex: number,
): Promise<void> {
  const summaryResult: SummarizeChaptersResult =
    await options.deps.collaborators.summarizeChaptersUseCase.execute({
      workspaceRoot: options.workspaceUri,
      chapterIndex,
    });

  if (!summaryResult.ok) {
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
  const assemblyResult: AssembleManuscriptResult = await assembleManuscriptUseCase.execute({
    workspaceRoot: workspaceUri,
  });
  if (!assemblyResult.ok) {
    throw new Error(
      assemblyResult.kind === 'failed'
        ? assemblyResult.message
        : `원고를 조립할 수 없습니다: ${assemblyResult.kind}`,
    );
  }
}

export interface ReviewStageResult {
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
  const manuscript: AssembledManuscript = assembleManuscript({
    plan,
    projectName: project.name,
    draftsByOrder,
    annotateSceneStems: true,
  });
  const characters: string[] = collectChapterPlanCharacterIds(plan);

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

    const reviseResult: ReviseDraftWorkflowResult =
      await options.deps.collaborators.reviseDraftUseCase.execute({
        workspaceUri: options.workspaceUri,
        paths,
        draftUri: draftPath(options.workspaceUri, target.sceneStem),
        sceneStem: target.sceneStem,
        maxIterations: 1,
        maxCompressionPercent:
          options.deps.host.configBridge.getMaxCompressionPercent?.() ??
          integerSettingDefault('revise.length.maxCompressionPercent'),
        reviseScoreThreshold: 0,
        seedIssues: target.seedIssues,
        shouldCancel: options.shouldCancel,
      });

    if (reviseResult.revisionCount > 0) {
      revisedStems.push(target.sceneStem);
    }

    await recordRevisionEntry(options.deps.host.fileSystem, paths, {
      sceneStem: target.sceneStem,
      checkedAt: new Date().toISOString(),
      revisionCount: reviseResult.revisionCount,
      remainingBlocking: reviseResult.remainingBlocking,
      instructions: reviseResult.instructions,
      preservedOriginal: reviseResult.preservedOriginal,
      rejection: reviseResult.rejection,
    });
  }

  return revisedStems;
}

export async function runSummariesStage(
  workspaceUri: StoryUri,
  summarizeChaptersUseCase: SummarizeChaptersUseCase,
): Promise<void> {
  const summaryResult: SummarizeChaptersResult = await summarizeChaptersUseCase.execute({
    workspaceRoot: workspaceUri,
  });
  if (!summaryResult.ok) {
    throw new Error(
      summaryResult.kind === 'failed'
        ? summaryResult.message
        : `장별 요약을 완료할 수 없습니다: ${summaryResult.kind}`,
    );
  }
}

export function groupChapterStems(
  plan: ChapterPlan,
  digitCount: number,
  sceneStemsByOrder: ReadonlyMap<number, string> = new Map(),
): ChapterGroup[] {
  const seeds: GeneratedSceneSeed[] = buildSceneSeeds(plan, digitCount);
  const flat: FlatChapterScene[] = flattenChapterPlan(plan);
  const groups: ChapterStemGroup[] = [];

  flat.forEach((flatScene, index) => {
    const stem: string | undefined = sceneStemsByOrder.get(index + 1) ?? seeds[index]?.stem;
    if (stem === undefined) {
      return;
    }

    const last: ChapterStemGroup | undefined = groups.at(-1);
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
