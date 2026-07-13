import type * as vscode from 'vscode';

import type { AssembleManuscriptUseCase } from '../manuscript/assembleManuscriptUseCase';
import type { SummarizeChaptersUseCase } from '../manuscript/summarizeChaptersUseCase';
import { assembleManuscript } from '../../core/manuscriptAssembly';
import { buildManuscriptReviewMarkdown } from '../../core/manuscriptReview';
import { draftPath, scenePath, type StoryboardProjectPaths } from '../../core/pathConventions';
import { recordRevisionEntry } from '../../core/revisionPlanRecorder';
import { buildSceneSeeds } from '../../core/sceneSeedFactory';
import type { NovelRunState, NovelStageName } from '../../domain/files/novelRunState';
import type { AiProviderRegistry } from '../../services/ai/providerRegistry';
import { flattenChapterPlan, toOutlineBrief, type ChapterPlan } from '../../shared/outline';
import type { StoryboardProject } from '../../shared/project';
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
  workspaceUri: vscode.Uri,
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
  workspaceUri: vscode.Uri,
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
): Promise<void> {
  for (const stem of group.stems) {
    if (options.shouldCancel()) {
      return;
    }

    const sceneUri = scenePath(options.workspaceUri, stem);
    const draftResult = await options.deps.generateDraftUseCase.execute(sceneUri, {
      force: false,
      suppressLoggerPanel: true,
      shouldCancel: options.shouldCancel,
    });

    if (!draftResult.ok) {
      if (draftResult.kind === 'cancelled') {
        return;
      }
      throw new Error(`초안 생성 실패(${stem}): ${draftResult.message}`);
    }

    const reviseResult = await options.deps.reviseDraftUseCase.execute({
      workspaceUri: options.workspaceUri,
      paths,
      draftUri: draftPath(options.workspaceUri, stem),
      sceneStem: stem,
      maxIterations: options.reviseMaxIterations,
      reviseScoreThreshold: 0,
      shouldCancel: options.shouldCancel,
    });

    await recordRevisionEntry(paths, {
      sceneStem: stem,
      checkedAt: new Date().toISOString(),
      revisionCount: reviseResult.revisionCount,
      remainingBlocking: reviseResult.remainingBlocking,
      instructions: reviseResult.instructions,
    });
  }
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

    await runChapterDraftsAndRevise(group, paths, options);

    await persist({ nextChapterIndex: chapterIndex + 1 });

    if (options.shouldCancel()) {
      return await cancel(persist);
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

export async function runAssembleStage(
  workspaceUri: vscode.Uri,
  assembleManuscriptUseCase: AssembleManuscriptUseCase,
): Promise<void> {
  const result = await assembleManuscriptUseCase.execute(workspaceUri);
  if (!result.ok) {
    throw new Error(
      result.kind === 'failed' ? result.message : `원고를 조립할 수 없습니다: ${result.kind}`,
    );
  }
}

export async function runReviewStage(
  workspaceUri: vscode.Uri,
  project: StoryboardProject,
  plan: ChapterPlan,
  aiService: NovelAiService,
  registry: AiProviderRegistry,
  reviewRepository: INovelReviewRepository,
): Promise<void> {
  const { draftsByOrder, canonFactLines } = await reviewRepository.loadReviewSource(workspaceUri);
  const manuscript = assembleManuscript({ plan, projectName: project.name, draftsByOrder });
  const characters = collectCharacterIds(plan);

  const [continuityIssues, critiqueIssues] = await Promise.all([
    aiService.checkContinuity(manuscript.volumeMarkdown, canonFactLines, {
      providerId: registry.getTaskProvider('continuityCheck'),
    }),
    aiService.critiqueDraft(
      {
        body: manuscript.volumeMarkdown,
        intent: '전체 원고 최종 검수',
        characters,
        facts: canonFactLines,
        styleConstraints: project.setting?.styleConstraints ?? [],
        qualityCriteria: project.setting?.qualityCriteria ?? [],
      },
      { providerId: registry.getTaskProvider('draftCritique') },
    ),
  ]);

  const reportMarkdown = buildManuscriptReviewMarkdown({
    projectName: project.name,
    sceneCount: manuscript.includedCount,
    generatedAt: new Date().toISOString(),
    continuityIssues,
    critiqueIssues,
  });

  await reviewRepository.saveReview(workspaceUri, reportMarkdown);
}

export async function runSummariesStage(
  workspaceUri: vscode.Uri,
  summarizeChaptersUseCase: SummarizeChaptersUseCase,
): Promise<void> {
  const result = await summarizeChaptersUseCase.execute(workspaceUri);
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
