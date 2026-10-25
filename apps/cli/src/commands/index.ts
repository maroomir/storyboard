import { resolve } from 'node:path';

import { ensureGitRepository, type GitRepositoryOutcome } from '@/adapters/gitRepository';

import {
  buildCompositionPreset,
  writeWorkspaceAgentGuidesIfMissing,
  createStoryboardDirectories,
  createWorkspace,
  mergeProjectSetting,
  ensureWorkspaceGitignore,
  sealStoryMemory,
  readProjectJson,
  novelStageLabel,
  resolveNovelPipelinePlan,
  sceneStageCatalog,
  describeReviseOutcome,
  type GenerateAllDraftsProgress,
  type ReviseOutcome,
  type GenerateAllDraftsResult,
  type GenerateDraftResult,
  type ReviseDraftWorkflowResult,
  type GenerateSceneBeatsResult,
  type GenerateOutlineResult,
  type AssembleManuscriptResult,
  type ReviewManuscriptResult,
  type SummarizeChaptersResult,
  type PrepareCardCandidatePromotionResult,
  type PrepareNoteCandidatePromotionResult,
  type PromoteCardCandidatesResult,
  type PromoteNoteCandidatesResult,
  type DiscardNoteCandidatesResult,
  type PrepareBibleCandidatePromotionResult,
  type RecommendCardsResult,
  type RenameCardResult,
  type SaveDraftEditResult,
  type CondenseDraftResult,
  type ExpandDraftResult,
  type SeedScenesResult,
  type CompleteStoryScenesProposal,
  type BuildStoryCardsProposal,
  type CreateSceneResult,
  type RenameSceneResult,
  type ApplyDraftFormatResult,
  type AugmentDraftResult,
  type LoadExportSourceResult,
  type ExportManuscriptResult,
  type GenerateStoryStateResult,
  type UpdateProjectContractResult,
  type CompositionPreset,
  type CheckDraftResult,
  type DraftCheckKind,
} from '@storyboard/story-engine';
import {
  draftPath,
  diffCandidatesAgainstCanon,
  getStoryboardProjectPaths,
  scenePath,
  NodeUri,
  type NovelRunState,
  type StoryUri,
  compositionCatalog,
  compositionKinds,
  formatSceneOrderRanges,
  mainThreadId,
  pointOfViewCatalog,
  pointOfViews,
  type CompositionKind,
  type NarratorCard,
  type PointOfView,
  type ProjectSetting,
  createEmptyBackground,
  createEmptyCharacter,
  parseSceneFileName,
  getProviderTransport,
  requiresApiKey,
  type AiProviderId,
  type MergedNoteCardCandidate,
  type SceneFile,
  type CardCandidateItem,
  type BibleCandidateRecord,
  type StoryboardProjectPaths,
  type ManuscriptExportFormat,
  type StoryboardProject,
  type NovelStageName,
  type StoryBible,
  type Character,
  type LocationBackgroundCard,
  type NovelRunMode,
} from '@storyboard/story-model';

import type { DraftAugmentScope, OAuthConnection } from '@storyboard/story-ai';
import type { IPrompter } from '@/adapters/prompter';
import type { CliContainer } from '@/container';
import type { NovelRunResult, WorkspaceStatus } from '@storyboard/story-app';
import { flagBoolean, flagString, type ParsedArguments } from '@/cliArguments';

import { cardCategories, draftCheckKinds, type CardCategory } from './catalog';
import type { CommandHandler, CommandOutcome } from './outcome';
import { absorbNotes, connectNotes, runNoteAbsorb, exportNotes } from './notes';
import { askLine, askSecret, readStdin } from './prompt';
import {
  createNarrator,
  describeSceneNarration,
  listNarrators,
  removeNarrator,
  showNarrator,
} from './narrators';
import { applySim, rejudgeSim, reportSim, runSim, screenSim, sweepSim } from './sim';
import {
  runConfigSet,
  runConfigShow,
  runConfigUnset,
  runDoctor,
  runParamsShow,
  runSetup,
} from './setup';
import { runLogin, runLogout } from './login';
import { showStatus } from './status';
import { listCards, listScenes, showCard, showDraft, showProject } from './views';
import { availableProviderIds } from '@/adapters/availableProviders';

export type { CommandContext, CommandHandler, CommandOutcome } from './outcome';

function sceneStemFrom(args: ParsedArguments, positionalIndex = 0): string | undefined {
  const raw: string | undefined = args.positionals[positionalIndex];
  if (raw === undefined) {
    return undefined;
  }
  const fileName: string = raw.endsWith('.card') ? raw : `${raw}.card`;
  return parseSceneFileName(fileName)?.stem ?? raw.replace(/\.card$/, '');
}

function sceneUriFor(root: StoryUri, stem: string): StoryUri {
  return scenePath(root, stem);
}

const unattendedRunApprovesEveryGate: NovelRunMode = 'auto';

const sceneStageLabels: Record<string, string> = Object.fromEntries(
  sceneStageCatalog.map((definition) => [definition.id, definition.label]),
);

function describeModel(container: CliContainer): string {
  const { configBridge } = container;
  const provider: AiProviderId = configBridge.getDefaultProvider();
  const model: string | undefined = configBridge.getProviderConfig(provider).model;
  return model === undefined ? provider : `${provider} · ${model}`;
}

interface PaidRunSummary {
  readonly title: string;
  readonly details: readonly string[];
}

async function confirmPaidRun(
  container: CliContainer,
  summarize: (status: WorkspaceStatus) => PaidRunSummary,
): Promise<boolean> {
  const { prompter } = container;

  if (prompter === undefined || !prompter.shouldConfirmPaidRuns) {
    return true;
  }

  const { title, details } = summarize(await container.describeWorkspace());
  const answer: boolean | undefined = await prompter.choose({
    title,
    details: [...details, `모델  ${describeModel(container)}`],
    options: [
      { label: '진행', value: true },
      { label: '취소', value: false },
    ],
  });
  return answer === true;
}

const cancelledBeforeRun: CommandOutcome = {
  ok: false,
  message: '취소했습니다. 아무것도 생성하지 않았습니다.',
  stop: 'cancelled',
};

function describeBatchStep(progress: GenerateAllDraftsProgress): string {
  switch (progress.kind) {
    case 'prepared':
      return '준비';
    case 'pipeline':
      return progress.stage === undefined
        ? '생성'
        : `${sceneStageLabels[progress.stage] ?? progress.stage} ${progress.stageCurrent ?? 0}/${progress.stageTotal ?? 0}`;
    case 'saving':
      return '저장';
    case 'revising':
      return '검수·수정';
  }
}

const generateScene: CommandHandler = async ({ container, args }) => {
  if (flagBoolean(args.flags, 'all')) {
    const isConfirmed: boolean = await confirmPaidRun(container, (status) => {
      const pending: number = status.drafts.missing + status.drafts.stale;
      return {
        title: `초안 ${pending}개 생성`,
        details: [
          `대상  초안이 없거나 카드보다 오래된 씬 ${pending}개 (전체 ${status.scenes.total}개)`,
        ],
      };
    });

    if (!isConfirmed) {
      return cancelledBeforeRun;
    }

    const result: GenerateAllDraftsResult = await container.drafts.generateAll({
      shouldPause: container.pauseRequests.watch(),
      onProgress: (progress) => {
        const step: string = describeBatchStep(progress);
        container.progress.update({
          line: `${progress.current}/${progress.total} ${progress.label} · ${step}`,
          unit: { current: progress.current, total: progress.total, label: progress.label },
          step,
        });
      },
    });

    if (!result.ok) {
      return { ok: false, message: describeBatchFailure(result.kind), data: result };
    }

    const { cacheHits, failureLabels, failures, generated, pausedWithRemaining } = result.summary;

    if (pausedWithRemaining !== undefined) {
      return {
        ok: false,
        message:
          `멈췄습니다: 생성 ${generated}건, 남은 씬 ${pausedWithRemaining}개. ` +
          '다시 실행하면 남은 씬부터 이어 갑니다.',
        data: result.summary,
        stop: 'paused',
      };
    }

    return {
      ok: failures === 0,
      message:
        failures === 0
          ? `초안 ${generated}건 생성, ${cacheHits}건은 입력이 같아 그대로 둡니다.`
          : `${failures}건 실패 (생성 ${generated}건, 캐시 ${cacheHits}건): ${failureLabels.join(', ')}`,
      data: result.summary,
    };
  }

  const stem: string | undefined = sceneStemFrom(args);
  if (stem === undefined) {
    return {
      ok: false,
      message: '씬 stem을 지정해 주세요. 예: storyboard draft generate 01-scene-1-1',
    };
  }

  const result: GenerateDraftResult = await container.drafts.generate({
    sceneUri: sceneUriFor(container.workspaceRoot, stem),
    force: flagBoolean(args.flags, 'force'),
    onPipelineProgress: (stage, current, total) => {
      const step: string = `${sceneStageLabels[stage] ?? stage} ${current}/${total}`;
      container.progress.update({ line: step, step });
    },
  });

  if (!result.ok) {
    return { ok: false, message: result.kind === 'failed' ? result.message : '취소했습니다.' };
  }

  const warnings: readonly string[] = result.kind === 'generated' ? result.warnings : [];
  for (const warning of warnings) {
    container.logger.warn(warning);
  }

  const reviseRequested: boolean =
    !flagBoolean(args.flags, 'no-revise') && container.configBridge.isReviseAfterGenerateEnabled();

  let revise: ReviseOutcome | undefined;
  if (result.kind === 'generated' && reviseRequested) {
    const revised: ReviseDraftWorkflowResult | undefined = await container.drafts.reviseScene(
      container.workspaceRoot,
      stem,
      {
        onProgress: (message) => container.progress.update({ line: message, step: message }),
      },
    );
    revise = revised && describeReviseOutcome(revised);

    if (revise?.warning) {
      container.logger.warn(revise.warning);
    }
  }

  return {
    ok: true,
    message:
      result.kind === 'cache_hit' ? '입력이 같아 기존 초안을 씁니다.' : '초안을 생성했습니다.',
    data: {
      draft: (result.draftUri as StoryUri).fsPath,
      warnings: revise?.warning ? [...warnings, revise.warning] : warnings,
      ...(revise === undefined ? {} : { revise }),
    },
  };
};

const generateSceneBeats: CommandHandler = async ({ container, args }) => {
  const force: boolean = flagBoolean(args.flags, 'force');
  const dryRun: boolean = flagBoolean(args.flags, 'dry-run');

  if (flagBoolean(args.flags, 'all')) {
    const stems: string[] = (await container.drafts.listScenes(container.workspaceRoot)).map(
      (scene) => scene.stem,
    );
    const results: Record<string, unknown> = {};
    const failures: string[] = [];
    let proposed: number = 0;

    for (const stem of stems) {
      const result: GenerateSceneBeatsResult = await runSceneBeats(container, stem, force, dryRun);
      results[stem] = result;
      if (!result.ok) {
        failures.push(stem);
      } else if (result.kind === 'proposed') {
        proposed += 1;
        container.logger.info(`${stem}: 비트 ${result.beats.length}개`);
      }
    }

    return {
      ok: failures.length === 0,
      message:
        failures.length === 0
          ? `씬 ${proposed}개의 비트를 ${dryRun ? '제안했습니다 (적용하지 않음)' : '썼습니다'}, ${stems.length - proposed}개는 그대로 둡니다.`
          : `${failures.length}건 실패 (비트 ${proposed}개 처리): ${failures.join(', ')}`,
      data: { proposed, failures, results },
    };
  }

  const stem: string | undefined = sceneStemFrom(args);
  if (stem === undefined) {
    return {
      ok: false,
      message: '씬 stem을 지정해 주세요. 예: storyboard scene plot 01-scene-1-1',
    };
  }

  const result: GenerateSceneBeatsResult = await runSceneBeats(container, stem, force, dryRun);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  if (result.kind === 'kept') {
    return {
      ok: true,
      message: `이미 비트 ${result.beats.length}개가 있습니다 (--force 로 다시 뽑습니다).`,
      data: { stem, beats: result.beats, written: false },
    };
  }

  return {
    ok: true,
    message: result.written
      ? `비트 ${result.beats.length}개를 카드에 썼습니다.`
      : `비트 ${result.beats.length}개를 제안했습니다 (적용하지 않음).`,
    data: { stem, beats: result.beats, written: result.written },
  };
};

function runSceneBeats(
  container: CliContainer,
  stem: string,
  force: boolean,
  dryRun: boolean,
): ReturnType<CliContainer['drafts']['generateBeats']> {
  return container.drafts.generateBeats({
    workspaceRoot: container.workspaceRoot,
    sceneUri: sceneUriFor(container.workspaceRoot, stem),
    fileName: `${stem}.card`,
    force,
    dryRun,
  });
}

const reviseScene: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);
  if (stem === undefined) {
    return { ok: false, message: '씬 stem을 지정해 주세요.' };
  }

  const result: ReviseDraftWorkflowResult | undefined = await container.drafts.reviseScene(
    container.workspaceRoot,
    stem,
  );
  if (result === undefined) {
    return { ok: false, message: '초안이 없어 검수를 건너뛰었습니다.' };
  }

  return result.failure
    ? {
        ok: false,
        message: describeReviseOutcome(result).warning ?? result.failure.message,
        data: result,
      }
    : { ok: true, message: '검수와 재작성을 마쳤습니다.', data: result };
};

const generateOutline: CommandHandler = async ({ container, args }) => {
  const result: GenerateOutlineResult = await container.novel.generateOutline({
    workspaceRoot: container.workspaceRoot,
    overwrite: flagBoolean(args.flags, 'force'),
    onProgress: (message: string) => container.progress.update({ line: message, step: message }),
  });

  return { ok: result.ok, message: describeOutlineResult(result.kind), data: result };
};

function describeBatchFailure(kind: 'no_projects' | 'no_scenes'): string {
  return kind === 'no_projects'
    ? 'Storyboard 프로젝트를 찾을 수 없습니다.'
    : '생성할 씬이 없습니다. scene/*.card 를 먼저 만들어 주세요.';
}

function describeOutlineResult(kind: string): string {
  switch (kind) {
    case 'generated':
      return '아웃라인을 생성했습니다.';
    case 'existing':
      return '아웃라인이 이미 있습니다. 덮어쓰려면 --force 를 주세요.';
    case 'missing_contract':
      return '작품 계약이 비어 아웃라인을 만들 수 없습니다. .storyboard/project.json 의 setting 을 채워 주세요.';
    default:
      return `아웃라인을 생성하지 못했습니다 (${kind}).`;
  }
}

const assembleManuscript: CommandHandler = async ({ container }) => {
  const result: AssembleManuscriptResult = await container.manuscript.assemble({
    workspaceRoot: container.workspaceRoot,
  });
  return {
    ok: result.ok,
    message: result.ok ? '원고를 조립했습니다.' : '조립하지 못했습니다.',
    data: result,
  };
};

const reviewManuscript: CommandHandler = async ({ container }) => {
  const result: ReviewManuscriptResult = await container.manuscript.review({
    workspaceRoot: container.workspaceRoot,
  });
  return {
    ok: result.ok,
    message: result.ok ? '원고 검사를 마쳤습니다.' : '검사하지 못했습니다.',
    data: result,
  };
};

const summarizeChapters: CommandHandler = async ({ container }) => {
  const result: SummarizeChaptersResult = await container.manuscript.summarizeChapters({
    workspaceRoot: container.workspaceRoot,
  });
  return {
    ok: result.ok,
    message: result.ok ? '장별 요약을 만들었습니다.' : '요약하지 못했습니다.',
    data: result,
  };
};

const generateNovel: CommandHandler = async ({ container, args }) => {
  const interrupted: NovelRunState | undefined = await container.novel.findResumableRun(
    container.workspaceRoot,
    {
      holdsRunLock: true,
    },
  );
  const restartChoice: 'restart' | 'resume' | undefined =
    interrupted === undefined
      ? 'restart'
      : await askResumeOrRestart(container.prompter, interrupted);

  if (restartChoice === undefined) {
    return cancelledBeforeRun;
  }

  const isConfirmed: boolean = await confirmPaidRun(container, (status) => ({
    title: '장편 생성',
    details: [
      `작품  ${status.project.name}`,
      `지금  씬 ${status.scenes.total}개 · 초안 ${status.drafts.ready}개`,
      '기획부터 원고 조립까지 이어서 돌립니다 (Esc 로 씬 경계에서 멈춤)',
    ],
  }));

  if (!isConfirmed) {
    return cancelledBeforeRun;
  }

  const project: StoryboardProject = await container.novel.readProject(container.workspaceRoot);
  const novelPlan: readonly NovelStageName[] = resolveNovelPipelinePlan();
  const reviseIterations: string | undefined = flagString(args.flags, 'revise-iterations');
  const result: NovelRunResult = await container.novel.run({
    workspaceUri: container.workspaceRoot,
    project,
    runMode: unattendedRunApprovesEveryGate,
    ...(reviseIterations === undefined ? {} : { reviseMaxIterations: Number(reviseIterations) }),
    ...(restartChoice === 'resume' && interrupted !== undefined
      ? { resumeState: interrupted }
      : {}),
    onProgress: (stage, message) =>
      container.progress.update({
        line: `${novelStageLabel(stage)}: ${message}`,
        step: message,
        checklist: {
          labels: novelPlan.map((name) => novelStageLabel(name)),
          currentIndex: novelPlan.indexOf(stage),
        },
      }),
    requestApproval: async () => true,
    shouldCancel: () => false,
    shouldPause: container.pauseRequests.watch(),
  });

  const { spending } = result;
  const budgetNote: string =
    result.outcome === 'paused' && spending.isOverBudget
      ? ` 이번 실행 예산 $${spending.budgetUsd}에 닿았습니다 (쓴 비용 $${spending.costUsd.toFixed(2)}).`
      : '';
  const cacheNote: string =
    spending.cache !== undefined && spending.cache.cachedTokens > 0
      ? ` 프롬프트 캐시 적중 ${Math.round((spending.cache.cachedTokens / spending.cache.promptTokens) * 100)}%, 절약 $${spending.cache.savedUsd.toFixed(2)}.`
      : '';

  return {
    ok: result.outcome === 'completed',
    message:
      result.outcome === 'failed'
        ? `장편 생성에 실패했습니다: ${result.message}`
        : `${result.message}${budgetNote}${cacheNote}`,
    data: { ...result, costUsd: spending.costUsd },
    ...(result.outcome === 'paused' || result.outcome === 'cancelled'
      ? { stop: result.outcome }
      : {}),
  };
};

async function askResumeOrRestart(
  prompter: IPrompter | undefined,
  interrupted: NovelRunState,
): Promise<'resume' | 'restart' | undefined> {
  if (prompter === undefined) {
    return 'resume';
  }

  const finished: string = interrupted.completedStages
    .map((stage) => novelStageLabel(stage))
    .join(', ');

  return await prompter.choose<'resume' | 'restart'>({
    title: '끊긴 장편 생성이 있습니다',
    details: [`끝난 단계  ${finished.length === 0 ? '없음' : finished}`],
    options: [
      { label: '이어 가기', value: 'resume' },
      { label: '처음부터 (있는 아웃라인·씬 카드는 그대로 씀)', value: 'restart' },
    ],
  });
}

const showScene: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  const scene: SceneFile | undefined = await container.drafts.readScene(
    container.workspaceRoot,
    stem,
  );

  if (scene === undefined) {
    return { ok: false, message: `씬을 찾을 수 없습니다: ${stem}` };
  }
  const narration: string = await describeSceneNarration(
    container,
    scene.card.narrator,
    scene.frontmatter.povCharacter,
  );
  const thread: string = scene.card.thread ?? mainThreadId;

  return {
    ok: true,
    message: [
      `${scene.card.title ?? stem} (${stem})`,
      `시점: ${narration}`,
      `줄기: ${thread}`,
      ...(scene.card.characters && scene.card.characters.length > 0
        ? [`인물: ${scene.card.characters.join(', ')}`]
        : []),
      ...(scene.card.location === undefined ? [] : [`배경: ${scene.card.location}`]),
      ...(scene.card.summary === undefined ? [] : ['', scene.card.summary]),
    ].join('\n'),
    data: {
      stem,
      title: scene.card.title ?? null,
      narrator: scene.card.narrator ?? null,
      narration,
      thread,
      characters: scene.card.characters ?? [],
    },
  };
};

function describeNoteConflicts(cards: readonly MergedNoteCardCandidate[]): string[] {
  const lines: string[] = cards.flatMap((card) =>
    card.conflicts.flatMap((conflict) => [
      `  보류      ${card.cardId} ${conflict.key} — 노트마다 값이 다릅니다`,
      ...conflict.options.map(
        (option) => `    [${option.ref}] ${option.value} ← ${option.locations.join(', ')}`,
      ),
    ]),
  );

  return lines.length === 0
    ? []
    : [...lines, '  하나만 남기려면: storyboard card discard <id> --change <ref>'];
}

const promoteCards: CommandHandler = async ({ container, args }) => {
  const prepared: PrepareCardCandidatePromotionResult =
    await container.cards.prepareCandidatePromotion(container.workspaceRoot);
  const preparedNotes: PrepareNoteCandidatePromotionResult =
    await container.notes.prepareCandidatePromotion(container.workspaceRoot);

  if (prepared.kind !== 'ready' && preparedNotes.kind !== 'ready') {
    const kind: 'no_candidates' | 'no_new_candidates' =
      prepared.kind === 'no_candidates' && preparedNotes.kind === 'no_candidates'
        ? 'no_candidates'
        : 'no_new_candidates';
    return { ok: true, message: describeNothingToPromote(kind), data: { kind } };
  }

  const draftItems: readonly CardCandidateItem[] = prepared.kind === 'ready' ? prepared.items : [];
  const noteCandidates: readonly MergedNoteCardCandidate[] =
    preparedNotes.kind === 'ready' ? preparedNotes.candidates : [];
  const conflictedCards: MergedNoteCardCandidate[] = [
    ...noteCandidates,
    ...(preparedNotes.kind === 'ready' ? preparedNotes.heldCards : []),
  ].filter((candidate) => candidate.conflicts.length > 0);
  const conflictLines: string[] = describeNoteConflicts(conflictedCards);

  if (flagBoolean(args.flags, 'dry-run')) {
    return {
      ok: true,
      message: [
        `승격 후보 ${draftItems.length + noteCandidates.length}건`,
        ...(draftItems.length > 0 ? [`  초안에서  ${draftItems.length}건`] : []),
        ...noteCandidates.map(
          (candidate) =>
            `  노트에서  ${candidate.cardId} (${candidate.name}) 변경 ${candidate.changes.length}건 ← ${candidate.locations.join(', ')}`,
        ),
        ...conflictLines,
      ].join('\n'),
      data: { drafts: draftItems, notes: noteCandidates, conflicts: conflictedCards },
    };
  }

  const result: PromoteCardCandidatesResult | undefined =
    draftItems.length > 0
      ? await container.cards.promoteCandidates(container.workspaceRoot, draftItems)
      : undefined;
  const noteResult: PromoteNoteCandidatesResult | undefined =
    noteCandidates.length > 0
      ? await container.notes.promoteCandidates(container.workspaceRoot, noteCandidates)
      : undefined;
  const isDraftSaveFailed: boolean = result !== undefined && result.kind !== 'promoted';
  const updatedCardCount: number =
    (result?.kind === 'promoted' ? result.updatedCardCount : 0) +
    (noteResult?.updatedCardIds.length ?? 0);

  return {
    ok: !isDraftSaveFailed,
    message: isDraftSaveFailed
      ? '카드를 저장하지 못했습니다.'
      : [`카드 ${updatedCardCount}개를 갱신했습니다.`, ...conflictLines].join('\n'),
    data: { drafts: result ?? null, notes: noteResult ?? null, conflicts: conflictedCards },
  };
};

const discardCardCandidates: CommandHandler = async ({ container, args }) => {
  const invalidId: string | undefined = args.positionals.find((id) => !cardIdPattern.test(id));

  if (invalidId !== undefined) {
    return { ok: false, message: `카드 id 가 올바르지 않습니다: ${invalidId}` };
  }

  const changeRef: string | undefined = flagString(args.flags, 'change');

  if (changeRef !== undefined) {
    const [cardId] = args.positionals;

    if (cardId === undefined || args.positionals.length > 1) {
      return {
        ok: false,
        message: '--change 는 카드 id 하나와 함께 씁니다: card discard <id> --change <ref>',
      };
    }

    const result: DiscardNoteCandidatesResult = await container.notes.discardCandidates(
      container.workspaceRoot,
      {
        kind: 'change',
        cardId,
        ref: changeRef,
      },
    );

    return result.kind === 'change_not_found'
      ? {
          ok: false,
          message: `${cardId} 의 노트 후보에 ${changeRef} 가 없습니다. card promote --dry-run 으로 확인하세요.`,
        }
      : { ok: true, message: `${cardId} 의 노트 후보 ${changeRef} 를 버렸습니다.`, data: result };
  }

  const cardIds: Set<string> | undefined =
    args.positionals.length > 0 ? new Set(args.positionals) : undefined;
  const notes: DiscardNoteCandidatesResult = await container.notes.discardCandidates(
    container.workspaceRoot,
    {
      kind: 'cards',
      ...(cardIds === undefined ? {} : { cardIds }),
    },
  );
  const draftItemCount: number = await container.cards.discardCandidates(
    container.workspaceRoot,
    cardIds,
  );
  const noteCardIds: readonly string[] = notes.kind === 'discarded' ? notes.cardIds : [];

  if (noteCardIds.length === 0 && draftItemCount === 0) {
    return { ok: true, message: '버릴 후보가 없습니다.', data: { notes: [], drafts: 0 } };
  }

  return {
    ok: true,
    message: [
      '후보를 버렸습니다.',
      ...(noteCardIds.length > 0 ? [`  노트에서  ${noteCardIds.join(', ')}`] : []),
      ...(draftItemCount > 0 ? [`  초안에서  ${draftItemCount}건`] : []),
    ].join('\n'),
    data: { notes: noteCardIds, drafts: draftItemCount },
  };
};

const promoteBible: CommandHandler = async ({ container, args }) => {
  const prepared: PrepareBibleCandidatePromotionResult =
    await container.cards.prepareBiblePromotion(container.workspaceRoot);

  if (prepared.kind !== 'ready') {
    return { ok: true, message: describeNothingToPromote(prepared.kind), data: prepared };
  }

  if (flagBoolean(args.flags, 'dry-run')) {
    return { ok: true, message: `승격 후보 ${prepared.facts.length}건`, data: prepared.facts };
  }

  await container.cards.promoteBibleFacts(container.workspaceRoot, prepared.facts);
  return {
    ok: true,
    message: `정전에 ${prepared.facts.length}건을 반영했습니다.`,
    data: prepared.facts,
  };
};

const recommendCards: CommandHandler = async ({ container, args }) => {
  const category: CardCategory | undefined = cardCategoryFrom(args);

  if (category === undefined) {
    return { ok: false, message: describeMissingCardCategory('card recommend') };
  }

  const result: RecommendCardsResult = await container.cards.recommend({
    category,
    workspaceRoot: container.workspaceRoot,
  });

  if (!result.ok) {
    return {
      ok: false,
      message: result.kind === 'cancelled' ? '취소했습니다.' : result.message,
      data: result,
    };
  }

  return result.kind === 'no_sources'
    ? { ok: true, message: '훑을 씬이나 초안이 없습니다.', data: [] }
    : {
        ok: true,
        message: `카드가 없는 ${category} ${result.recommendations.length}건`,
        data: result.recommendations,
      };
};

const cardIdPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

function cardCategoryFrom(args: ParsedArguments): CardCategory | undefined {
  return cardCategories.find((category) => category === args.positionals[0]);
}

function describeMissingCardCategory(verb: string): string {
  return `카드 종류를 지정해 주세요: storyboard ${verb} <${cardCategories.join('|')}>`;
}

const renameCard: CommandHandler = async ({ container, args }) => {
  const category: CardCategory | undefined = cardCategoryFrom(args);
  const fromId: string | undefined = args.positionals[1];
  const toId: string | undefined = flagString(args.flags, 'to');

  if (category === undefined) {
    return { ok: false, message: describeMissingCardCategory('card rename') };
  }

  if (fromId === undefined || toId === undefined) {
    return { ok: false, message: '바꿀 id 와 --to <새 id> 를 지정해 주세요.' };
  }

  const result: RenameCardResult = await container.cards.rename({
    workspaceRoot: container.workspaceRoot,
    category,
    fromId,
    toId,
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  for (const path of result.unreadableFiles) {
    container.logger.warn(`참조를 갱신하지 못했습니다: ${path}`);
  }

  return {
    ok: true,
    message: `${fromId} → ${toId}${result.rewrittenCount > 0 ? ` (참조 ${result.rewrittenCount}건 갱신)` : ''}`,
    data: { oldId: fromId, newId: toId, rewritten: result.rewrittenCount },
  };
};

interface LineRange {
  readonly from: number;
  readonly to: number;
}

function parseLineRange(raw: string | undefined): LineRange | undefined | 'invalid' {
  if (raw === undefined) {
    return undefined;
  }

  const match: RegExpExecArray | null = /^(\d+)-(\d+)$/.exec(raw.trim());

  if (!match) {
    return 'invalid';
  }

  const from: number = Number(match[1]);
  const to: number = Number(match[2]);
  return from >= 1 && to >= from ? { from, to } : 'invalid';
}

function sliceLines(body: string, range: LineRange | undefined): string {
  if (range === undefined) {
    return body;
  }

  return body
    .split('\n')
    .slice(range.from - 1, range.to)
    .join('\n');
}

function replaceLines(body: string, range: LineRange | undefined, replacement: string): string {
  if (range === undefined) {
    return replacement;
  }

  const lines: string[] = body.split('\n');
  return [
    ...lines.slice(0, range.from - 1),
    ...replacement.split('\n'),
    ...lines.slice(range.to),
  ].join('\n');
}

interface TransformedDraft {
  ok: boolean;
  text?: string;
  message: string;
}

type LoadedDraftTarget =
  | { ok: true; body: string; target: string }
  | { ok: false; message: string };

async function loadDraftTarget(
  container: CliContainer,
  stem: string,
  range: LineRange | undefined,
): Promise<LoadedDraftTarget> {
  const body: string | undefined = await readDraftBody(container, stem);

  if (body === undefined) {
    return { ok: false, message: `초안이 없습니다: ${stem}` };
  }

  const target: string = sliceLines(body, range);

  if (target.trim().length === 0) {
    return { ok: false, message: '대상 구간이 비어 있습니다.' };
  }

  return { ok: true, body, target };
}

async function rewriteDraft(
  container: CliContainer,
  stem: string,
  range: LineRange | undefined,
  transform: (target: string) => Promise<TransformedDraft>,
): Promise<CommandOutcome> {
  const loaded: LoadedDraftTarget = await loadDraftTarget(container, stem, range);

  if (!loaded.ok) {
    return loaded;
  }

  const { body, target } = loaded;
  const result: TransformedDraft = await transform(target);

  if (!result.ok || result.text === undefined) {
    return { ok: false, message: result.message };
  }

  const saved: SaveDraftEditResult = await container.drafts.saveEdit({
    workspaceRoot: container.workspaceRoot,
    sceneStem: stem,
    body: replaceLines(body, range, result.text),
    archivePrevious: container.configBridge.isKeepDraftHistoryEnabled(),
  });

  if (!saved.ok) {
    return { ok: false, message: `초안이 없습니다: ${stem}` };
  }

  const draftUri: StoryUri = draftPath(container.workspaceRoot, stem);

  return { ok: true, message: result.message, data: { draft: draftUri.fsPath } };
}

function rangeFrom(args: ParsedArguments): LineRange | undefined | 'invalid' {
  return parseLineRange(flagString(args.flags, 'lines'));
}

const condenseDraft: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);
  const range: LineRange | 'invalid' | undefined = rangeFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  if (range === 'invalid') {
    return { ok: false, message: '--lines 는 40-60 형식이어야 합니다.' };
  }

  const project: StoryboardProject = await container.novel.readProject(container.workspaceRoot);

  return rewriteDraft(container, stem, range, async (target) => {
    const result: CondenseDraftResult = await container.drafts.condense({
      workspaceRoot: container.workspaceRoot,
      sceneStem: stem,
      format: project.format,
      body: target,
      maxCompressionPercent: container.configBridge.getMaxCompressionPercent(),
    });

    return result.ok
      ? { ok: true, text: result.text, message: '초안을 압축했습니다.' }
      : { ok: false, message: `압축하지 못했습니다 (${result.kind}).` };
  });
};

const expandDraft: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);
  const range: LineRange | 'invalid' | undefined = rangeFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  if (range === 'invalid') {
    return { ok: false, message: '--lines 는 40-60 형식이어야 합니다.' };
  }

  return rewriteDraft(container, stem, range, async (target) => {
    const result: ExpandDraftResult = await container.drafts.expand({
      workspaceRoot: container.workspaceRoot,
      sceneStem: stem,
      selectedText: target,
    });

    return result.ok
      ? { ok: true, text: result.text, message: '구간을 늘렸습니다.' }
      : { ok: false, message: `늘리지 못했습니다 (${result.kind}).` };
  });
};

const generateSceneSeeds: CommandHandler = async ({ container, args }) => {
  const result: SeedScenesResult = await container.novel.seedScenes({
    workspaceRoot: container.workspaceRoot,
    overwrite: flagBoolean(args.flags, 'force'),
  });

  switch (result.kind) {
    case 'seeded':
      return {
        ok: true,
        message: `씬 시드 ${result.fileNames.length}개를 생성했습니다.`,
        data: result.fileNames,
      };
    case 'empty_plan':
      return { ok: true, message: '아웃라인에 생성할 씬이 없습니다.', data: [] };
    case 'missing_outline':
      return {
        ok: false,
        message: '아웃라인(chapters.yaml)이 없습니다. outline generate 를 먼저 실행해 주세요.',
      };
    case 'existing_scenes':
      return {
        ok: false,
        message: `씬 파일이 이미 ${result.existingCount}개 있습니다. 덮어쓰려면 --force 를 주세요.`,
      };
    case 'failed':
      return { ok: false, message: result.message };
  }
};

const completeStory: CommandHandler = async ({ container, args }) => {
  const proposal: CompleteStoryScenesProposal = await container.novel.completeScenes({
    workspaceRoot: container.workspaceRoot,
  });

  if (flagBoolean(args.flags, 'dry-run')) {
    return { ok: true, message: `완결 씬 제안 ${proposal.scenes.length}건`, data: proposal };
  }

  const { writtenFileNames: written, skippedFileNames: skipped } =
    await container.novel.applyCompletedScenes(container.workspaceRoot, proposal.scenes);

  return {
    ok: true,
    message:
      skipped.length === 0
        ? `완결 씬 ${written.length}개를 만들었습니다.`
        : `완결 씬 ${written.length}개를 만들고 이미 있는 ${skipped.length}개는 건너뛰었습니다.`,
    data: {
      written,
      skipped,
      centralQuestion: proposal.centralQuestion,
      climaxChoice: proposal.climaxChoice,
    },
  };
};

const buildStoryCards: CommandHandler = async ({ container, args }) => {
  const proposal: BuildStoryCardsProposal = await container.cards.buildFromScenes({
    workspaceRoot: container.workspaceRoot,
  });

  if (flagBoolean(args.flags, 'dry-run')) {
    return { ok: true, message: `카드 구성안 ${proposal.targets.length}건`, data: proposal };
  }

  const { writtenIds: written, needsIdNames: needsId } = await container.cards.applyBuildTargets(
    container.workspaceRoot,
    proposal.targets,
  );

  return {
    ok: true,
    message: describeCardBuild(written.length, needsId),
    data: { written, needsId },
  };
};

function describeCardBuild(writtenCount: number, needsId: readonly string[]): string {
  if (needsId.length === 0) {
    return `카드 ${writtenCount}개를 갱신했습니다.`;
  }

  return (
    `카드 ${writtenCount}개를 갱신했습니다. id 를 정할 수 없어 건너뛴 새 카드: ${needsId.join(', ')}. ` +
    'card create 로 --id 를 지정해 만든 뒤 다시 실행해 주세요.'
  );
}

const canonDiff: CommandHandler = async ({ container }) => {
  const canon: StoryBible = await container.cards.bibleCandidates.loadCanon(
    container.workspaceRoot,
  );
  const candidates: readonly BibleCandidateRecord[] =
    await container.cards.bibleCandidates.loadRecords(container.workspaceRoot);
  const { pending } = diffCandidatesAgainstCanon(canon, candidates);

  return {
    ok: true,
    message:
      pending.length === 0 ? '정전과 어긋나는 후보가 없습니다.' : `미승격 후보 ${pending.length}건`,
    data: pending,
  };
};

const createCard: CommandHandler = async ({ container, args }) => {
  const kind: CardCategory | undefined = cardCategoryFrom(args);
  const name: string | undefined = flagString(args.flags, 'name') ?? args.positionals[1];

  if (kind === undefined) {
    return { ok: false, message: describeMissingCardCategory('card create') };
  }

  if (name === undefined || name.trim().length === 0) {
    return { ok: false, message: '--name 으로 이름을 지정해 주세요.' };
  }

  const cardType: 'character' | 'location' = kind === 'character' ? 'character' : 'location';
  const explicitId: string | undefined = flagString(args.flags, 'id');
  const suggested: string | undefined = explicitId ?? slugify(name);

  if (suggested === undefined) {
    return {
      ok: false,
      message: `'${name.trim()}' 에서 id 를 만들 수 없습니다. --id hana 처럼 영문 id 를 주세요 (영소문자·숫자·하이픈).`,
    };
  }

  if (!cardIdPattern.test(suggested)) {
    return {
      ok: false,
      message: `id 는 영소문자·숫자·하이픈만 쓸 수 있습니다: ${suggested}`,
    };
  }

  if (
    explicitId !== undefined &&
    (await container.cards.exists(container.workspaceRoot, cardType, explicitId))
  ) {
    return {
      ok: false,
      message: `이미 있는 카드입니다: ${explicitId}. 다른 id 를 주거나 card show ${explicitId} 로 확인하세요.`,
    };
  }

  const id: string = await container.cards.deriveUniqueId(
    container.workspaceRoot,
    cardType,
    suggested,
    suggested,
  );
  const card: Character | LocationBackgroundCard =
    kind === 'character'
      ? createEmptyCharacter(id, name.trim())
      : createEmptyBackground(id, name.trim());
  const uri: StoryUri = await container.cards.write(container.workspaceRoot, card);

  return {
    ok: true,
    message: `${id} 카드를 만들었습니다.`,
    data: { id, path: (uri as StoryUri).fsPath },
  };
};

const createScene: CommandHandler = async ({ container, args }) => {
  const name: string | undefined = flagString(args.flags, 'name') ?? args.positionals[0];

  if (name === undefined || name.trim().length === 0) {
    return { ok: false, message: '--name 으로 씬 이름을 지정해 주세요.' };
  }

  const slug: string | undefined = slugify(name);
  const result: CreateSceneResult = await container.drafts.createScene({
    workspaceRoot: container.workspaceRoot,
    ...(slug === undefined ? {} : { slug }),
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  return {
    ok: true,
    message: `${result.stem}.card 를 만들었습니다.`,
    data: { stem: result.stem, path: (result.uri as StoryUri).fsPath },
  };
};

const renameScene: CommandHandler = async ({ container, args }) => {
  const fromStem: string | undefined = args.positionals[0];
  const toStem: string | undefined = flagString(args.flags, 'to');

  if (fromStem === undefined || toStem === undefined) {
    return { ok: false, message: '바꿀 씬과 --to <새 이름> 을 지정해 주세요.' };
  }

  const result: RenameSceneResult = await container.drafts.renameScene({
    workspaceRoot: container.workspaceRoot,
    fromStem,
    toStem,
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  const orderNote: '' | ' 번호가 바뀌었으므로 아웃라인의 자리와 장 배정도 새 번호를 따릅니다.' =
    result.hasOrderChanged
      ? ' 번호가 바뀌었으므로 아웃라인의 자리와 장 배정도 새 번호를 따릅니다.'
      : '';

  return {
    ok: true,
    message: `${result.fromStem} → ${result.toStem} (옮긴 파일 ${result.movedFiles.length}개, 고친 파일 ${result.rewrittenFiles.length}개).${orderNote}`,
    data: result,
  };
};

function slugify(name: string): string | undefined {
  const slug: string = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : undefined;
}

const applyDraftFormat: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  const result: ApplyDraftFormatResult = await container.drafts.applyFormat({
    workspaceRoot: container.workspaceRoot,
    sceneStem: stem,
  });

  return {
    ok: result.ok,
    message: result.ok
      ? '초안 형식을 다시 적용했습니다.'
      : `형식을 적용하지 못했습니다 (${result.kind}).`,
    data: result,
  };
};

const augmentDraft: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);
  const range: LineRange | 'invalid' | undefined = rangeFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  if (range === 'invalid') {
    return { ok: false, message: '--lines 는 40-60 형식이어야 합니다.' };
  }

  return augmentDraftRange(container, stem, range, {
    scope: range === undefined ? 'draft' : 'selection',
    instruction: flagString(args.flags, 'instruction'),
    isDryRun: flagBoolean(args.flags, 'dry-run'),
    appliedMessage: '카드 기반 보충을 반영했습니다.',
    proposedMessage: '보충안을 만들었습니다 (적용하지 않음).',
    failedLabel: '보충하지 못했습니다',
  });
};

const editDraft: CommandHandler = async ({ container, args }) => {
  const stem: string | undefined = sceneStemFrom(args);
  const range: LineRange | 'invalid' | undefined = rangeFrom(args);
  const instruction: string | undefined = flagString(args.flags, 'instruction');

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  if (range === 'invalid') {
    return { ok: false, message: '--lines 는 40-60 형식이어야 합니다.' };
  }

  if (instruction === undefined || instruction.trim().length === 0) {
    return { ok: false, message: '--instruction 으로 어떻게 고칠지 알려 주세요.' };
  }

  return augmentDraftRange(container, stem, range, {
    scope: 'selection',
    instruction,
    isDryRun: flagBoolean(args.flags, 'dry-run'),
    appliedMessage: '지시대로 고쳤습니다.',
    proposedMessage: '수정안을 만들었습니다 (적용하지 않음).',
    failedLabel: '고치지 못했습니다',
  });
};

interface AugmentDraftRangeOptions {
  readonly scope: DraftAugmentScope;
  readonly instruction: string | undefined;
  readonly isDryRun: boolean;
  readonly appliedMessage: string;
  readonly proposedMessage: string;
  readonly failedLabel: string;
}

async function augmentDraftRange(
  container: CliContainer,
  stem: string,
  range: LineRange | undefined,
  options: AugmentDraftRangeOptions,
): Promise<CommandOutcome> {
  const prepare = (target: string): Promise<AugmentDraftResult> =>
    container.drafts.prepareAugmentation({
      draftSceneStem: stem,
      sceneUri: scenePath(container.workspaceRoot, stem),
      scope: options.scope,
      target,
      workspaceRoot: container.workspaceRoot,
      ...(options.instruction === undefined ? {} : { instruction: options.instruction }),
    });

  if (options.isDryRun) {
    const loaded: LoadedDraftTarget = await loadDraftTarget(container, stem, range);

    if (!loaded.ok) {
      return loaded;
    }

    const prepared: AugmentDraftResult = await prepare(loaded.target);

    return prepared.ok
      ? { ok: true, message: options.proposedMessage, data: prepared }
      : { ok: false, message: `${options.failedLabel} (${prepared.kind}).`, data: prepared };
  }

  return rewriteDraft(container, stem, range, async (target) => {
    const prepared: AugmentDraftResult = await prepare(target);

    return prepared.ok
      ? { ok: true, text: prepared.text, message: options.appliedMessage }
      : { ok: false, message: `${options.failedLabel} (${prepared.kind}).` };
  });
}

const exportManuscript: CommandHandler = async ({ container, args }) => {
  const source: LoadExportSourceResult = await container.manuscript.loadExportSource(
    container.workspaceRoot,
  );

  if (!source.ok) {
    return { ok: false, message: `내보낼 원고가 없습니다 (${source.kind}).`, data: source };
  }

  const target: string | undefined = flagString(args.flags, 'out');

  if (target === undefined) {
    process.stdout.write(source.markdown);
    return { ok: true, message: '', data: { projectName: source.projectName } };
  }

  const format: ManuscriptExportFormat = target.toLowerCase().endsWith('.txt') ? 'txt' : 'md';
  const exported: ExportManuscriptResult = await container.manuscript.writeExport(
    NodeUri.file(resolve(target)),
    source.markdown,
    format,
  );

  if (!exported.ok) {
    return { ok: false, message: `내보내지 못했습니다: ${exported.message}` };
  }

  return {
    ok: true,
    message: `${target} 로 내보냈습니다.`,
    data: { path: target, format },
  };
};

async function sealWorkspaceStoryState(
  container: CliContainer,
  paths: ReturnType<typeof getStoryboardProjectPaths>,
): Promise<readonly number[]> {
  const project: StoryboardProject | undefined = await readProjectJson(
    container.fileSystem,
    paths.projectJson,
  ).catch(() => undefined);

  if (project === undefined) {
    return [];
  }

  return await sealStoryMemory({
    fileSystem: container.fileSystem,
    paths,
    format: project.format,
    sceneBreakJoiner: container.configBridge.getDraftSceneBreakSeparator(),
  });
}

function parseSceneOrders(raw: string): readonly number[] | undefined {
  const orders: Set<number> = new Set<number>();

  for (const part of raw.split(',')) {
    const bounds: RegExpExecArray | null = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    const start: number = Number(bounds?.[1]);

    if (bounds === undefined || bounds === null || !Number.isInteger(start)) {
      return undefined;
    }

    const end: number = bounds[2] === undefined ? start : Number(bounds[2]);

    if (end < start) {
      return undefined;
    }

    for (let order: number = start; order <= end; order += 1) {
      orders.add(order);
    }
  }

  return [...orders];
}

const generateState: CommandHandler = async ({ container, args }) => {
  const rawOrders: string | undefined = args.positionals[0];
  const sceneOrders: readonly number[] | undefined =
    rawOrders === undefined ? undefined : parseSceneOrders(rawOrders);

  if (rawOrders !== undefined && sceneOrders === undefined) {
    return {
      ok: false,
      message: `씬 범위를 알아볼 수 없습니다: ${rawOrders}\n  5 · 5-8 · 5,7,9 처럼 적어 주세요.`,
    };
  }

  const result: GenerateStoryStateResult = await container.drafts.generateStoryState({
    workspaceRoot: container.workspaceRoot,
    ...(sceneOrders === undefined ? {} : { sceneOrders }),
    force: flagBoolean(args.flags, 'force'),
    shouldPause: container.pauseRequests.watch(),
    onProgress: (progress) => {
      container.progress.update({
        line: `${progress.current}/${progress.total} ${progress.stem} · 원장 기록`,
        unit: { current: progress.current, total: progress.total, label: progress.stem },
        step: '원장 기록',
      });
    },
  });

  const { recorded, kept, withoutDraft, failures, pausedWithRemaining } = result;
  const summary: string =
    `원장에 씬 ${recorded.length}개를 기록했습니다` +
    (kept.length > 0 ? `, ${kept.length}개는 이미 있어 그대로 둡니다` : '') +
    (withoutDraft.length > 0 ? `, 초안 없는 씬 ${withoutDraft.length}개는 건너뜁니다` : '') +
    '.';

  if (pausedWithRemaining !== undefined) {
    return {
      ok: false,
      message: `멈췄습니다: 기록 ${recorded.length}건, 남은 씬 ${pausedWithRemaining}개. 다시 실행하면 이어서 기록합니다.`,
      data: result,
    };
  }

  if (failures.length > 0) {
    return {
      ok: false,
      message: `${failures.length}건 실패 (기록 ${recorded.length}건): ${failures.map((failure) => `${failure.stem} — ${failure.message}`).join(', ')}`,
      data: result,
    };
  }

  return { ok: true, message: summary, data: result };
};

const resealState: CommandHandler = async ({ container, args }) => {
  const rawOrders: string | undefined = args.positionals[0];
  const sceneOrders: readonly number[] | undefined =
    rawOrders === undefined ? undefined : parseSceneOrders(rawOrders);

  if (rawOrders !== undefined && sceneOrders === undefined) {
    return {
      ok: false,
      message: `씬 범위를 알아볼 수 없습니다: ${rawOrders}\n  5 · 5-8 · 5,7,9 처럼 적어 주세요.`,
    };
  }

  const resealed: readonly number[] = await container.drafts.resealStoryState(
    container.workspaceRoot,
    sceneOrders,
  );

  return {
    ok: true,
    message:
      resealed.length === 0
        ? '다시 봉인할 낡은 항목이 없습니다.'
        : `씬 ${formatSceneOrderRanges(resealed)}의 원장 항목을 지금의 카드·씬으로 다시 봉인했습니다.`,
    data: { sceneOrders: resealed },
  };
};

const initProject: CommandHandler = async ({ container, args }) => {
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(container.workspaceRoot);

  const isExistingWorkspace: boolean = await container.fileSystem.exists(paths.projectJson);

  if (flagBoolean(args.flags, 'repair')) {
    if (!isExistingWorkspace) {
      return {
        ok: false,
        message: 'Storyboard 워크스페이스가 아닙니다: storyboard init --title "작품 이름"',
      };
    }

    await createStoryboardDirectories(container.fileSystem, paths);
    await ensureWorkspaceGitignore(container.fileSystem, paths.gitignore);
    const addedAgentGuides: string[] = await writeWorkspaceAgentGuidesIfMissing(
      container.fileSystem,
      paths,
    );
    const gitRepository: GitRepositoryOutcome = ensureGitRepository(container.workspaceRoot.fsPath);
    const sealedSceneOrders: readonly number[] = await sealWorkspaceStoryState(container, paths);

    return {
      ok: true,
      message:
        (sealedSceneOrders.length === 0
          ? '디렉터리와 .gitignore 를 최신으로 맞췄습니다. 작품 계약은 그대로입니다.'
          : `디렉터리와 .gitignore 를 최신으로 맞추고, 이야기 상태 원장의 씬 ${formatSceneOrderRanges(sealedSceneOrders)}를 지금의 카드·씬으로 봉인했습니다. 작품 계약은 그대로입니다.`) +
        (addedAgentGuides.length === 0
          ? ''
          : ` 에이전트 지침 ${addedAgentGuides.join(', ')} 를 추가했습니다.`) +
        describeGitRepository(gitRepository),
      data: { repaired: true, sealedSceneOrders, addedAgentGuides, gitRepository },
    };
  }

  if (isExistingWorkspace) {
    return {
      ok: false,
      message: '이미 Storyboard 워크스페이스입니다. 발판만 보수하려면 storyboard init --repair',
    };
  }

  const name: string | undefined = flagString(args.flags, 'title') ?? args.positionals[0];
  const hasName: boolean = name !== undefined && name.trim().length > 0;

  if (!hasName && container.prompter !== undefined) {
    const answers: Record<string, string> | undefined = await askInitContract(
      container.prompter,
      args,
    );

    return answers === undefined
      ? { ok: false, message: '취소했습니다. 아무것도 만들지 않았습니다.', stop: 'cancelled' }
      : initProject({ container, args: { ...args, flags: { ...args.flags, ...answers } } });
  }

  if (name === undefined || !hasName) {
    return {
      ok: false,
      message: '작품 이름이 필요합니다: storyboard init --title "작품 이름"',
    };
  }

  const contract: ContractInput = await readContractInput(container, args);

  if ('message' in contract) {
    return { ok: false, message: contract.message };
  }

  const language: string | undefined = flagString(args.flags, 'language');
  const setting: ProjectSetting | undefined =
    contract.setting === undefined ? undefined : mergeProjectSetting(undefined, contract.setting);
  const { project, createdNarrators } = await createWorkspace({
    fileSystem: container.fileSystem,
    workspaceRoot: container.workspaceRoot,
    name,
    ...(language === undefined ? {} : { language }),
    ...(setting === undefined ? {} : { setting }),
    narratorCards: contract.narratorCards ?? [],
  });
  const gitRepository: GitRepositoryOutcome = ensureGitRepository(container.workspaceRoot.fsPath);
  const fromNotes: string | undefined = flagString(args.flags, 'from-notes');

  if (fromNotes !== undefined) {
    const absorbed: CommandOutcome = await runNoteAbsorb(container, args, fromNotes, {
      shouldFillContract: true,
      retryCommand: `storyboard notes absorb '${fromNotes.replace(/'/g, `'\\''`)}' --yes`,
    });

    return {
      ok: absorbed.ok,
      message:
        `${project.name} 워크스페이스를 만들었습니다: ${container.workspaceRoot.fsPath}` +
        `${describeGitRepository(gitRepository)}\n${absorbed.message}`,
      data: { id: project.id, name: project.name, gitRepository, notes: absorbed.data ?? null },
    };
  }

  return {
    ok: true,
    message: [
      `${project.name} 워크스페이스를 만들었습니다: ${container.workspaceRoot.fsPath}` +
        describeGitRepository(gitRepository),
      ...(createdNarrators.length > 0
        ? [`서술자 카드를 만들었습니다: ${createdNarrators.join(', ')}`]
        : []),
      ...(container.configBridge.isDefaultProviderConfigured()
        ? []
        : ['AI 프로바이더가 아직 없습니다: `storyboard setup`']),
    ].join('\n'),
    data: {
      id: project.id,
      name: project.name,
      format: project.format,
      setting: project.setting,
      gitRepository,
    },
  };
};

function describeGitRepository(outcome: GitRepositoryOutcome): string {
  switch (outcome) {
    case 'initialized':
      return ' git 저장소도 만들었습니다(main). 첫 커밋은 직접 남기세요.';
    case 'unavailable':
      return ' git 을 실행하지 못해 저장소는 만들지 않았습니다.';
    case 'exists':
      return '';
  }
}

const setProjectContract: CommandHandler = async ({ container, args }) => {
  const contract: ContractInput = await readContractInput(container, args);

  if ('message' in contract) {
    return { ok: false, message: contract.message };
  }

  if (contract.setting === undefined) {
    return {
      ok: false,
      message:
        '바꿀 값을 지정해 주세요. --genre --audience --pov --target-words --chapters --scenes-per-chapter --concept --description --composition 또는 --from <json>.',
    };
  }

  const updated: UpdateProjectContractResult = await container.novel.updateContract({
    workspaceRoot: container.workspaceRoot,
    setting: contract.setting,
    ...(contract.narratorCards === undefined ? {} : { narratorCards: contract.narratorCards }),
  });

  if (!updated.ok) {
    return { ok: false, message: updated.message };
  }

  return { ok: true, message: '작품 계약을 갱신했습니다.', data: updated.setting };
};

type ContractInput =
  | {
      readonly setting: Partial<ProjectSetting> | undefined;
      readonly narratorCards?: readonly NarratorCard[];
    }
  | { readonly message: string };

async function askInitContract(
  prompter: IPrompter,
  args: ParsedArguments,
): Promise<Record<string, string> | undefined> {
  const later: string = '';
  prompter.announce('┌  새 작품 만들기');

  const title: string | undefined = await prompter.askText({ title: '작품 이름' });
  if (title === undefined || title.length === 0) {
    return undefined;
  }
  prompter.announce(`◇  작품 이름  › ${title}`);
  const answers: Record<string, string> = { title };

  if (flagString(args.flags, 'genre') === undefined) {
    const genre: string | undefined = await prompter.askText({
      title: '장르',
      hint: '비우면 나중에',
    });
    if (genre === undefined) {
      return undefined;
    }
    prompter.announce(`◇  장르  › ${genre.length > 0 ? genre : '나중에'}`);
    if (genre.length > 0) {
      answers.genre = genre;
    }
  }

  if (flagString(args.flags, 'pov') === undefined) {
    const pov: string | undefined = await prompter.choose<string>({
      title: '시점',
      details: [],
      options: [
        ...pointOfViews.map((value) => ({ label: pointOfViewCatalog[value].optionLabel, value })),
        { label: '나중에 정하기', value: later },
      ],
    });
    if (pov === undefined) {
      return undefined;
    }
    prompter.announce(
      `◇  시점  › ${pov === later ? '나중에' : pointOfViewCatalog[pov as PointOfView].label}`,
    );
    if (pov !== later) {
      answers.pov = pov;
    }
  }

  if (flagString(args.flags, 'composition') === undefined) {
    const composition: CompositionKind | undefined = await prompter.choose<CompositionKind>({
      title: '구성',
      details: [],
      options: compositionKinds.map((value) => ({
        label: compositionCatalog[value].optionLabel,
        value,
      })),
    });
    if (composition === undefined) {
      return undefined;
    }
    prompter.announce(`◇  구성  › ${compositionCatalog[composition].label}`);
    answers.composition = composition;
  }

  prompter.announce('└  만드는 중…');
  return answers;
}

async function readContractInput(
  container: CliContainer,
  args: ParsedArguments,
): Promise<ContractInput> {
  const fromPath: string | undefined = flagString(args.flags, 'from');
  let fromFile: Partial<ProjectSetting> | undefined;

  if (fromPath !== undefined) {
    try {
      const bytes: Uint8Array = await container.fileSystem.readFile(
        NodeUri.file(resolve(fromPath)),
      );
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { message: `${fromPath} 의 최상위는 객체여야 합니다.` };
      }

      const record: Record<string, unknown> = parsed as Record<string, unknown>;
      fromFile = (record.setting ?? record) as Partial<ProjectSetting>;
    } catch (error) {
      return {
        message: `${fromPath} 를 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const pov: string | undefined = flagString(args.flags, 'pov');

  if (pov !== undefined && !pointOfViews.includes(pov as PointOfView)) {
    return { message: `--pov 는 ${pointOfViews.join(', ')} 중 하나여야 합니다.` };
  }

  const numbers: Array<[keyof ProjectSetting, string]> = [
    ['targetWordCount', 'target-words'],
    ['chapterCount', 'chapters'],
    ['scenesPerChapter', 'scenes-per-chapter'],
  ];
  const parsedNumbers: Record<string, number> = {};

  for (const [key, flag] of numbers) {
    const raw: string | undefined = flagString(args.flags, flag);

    if (raw === undefined) {
      continue;
    }

    const value: number = Number(raw);

    if (!Number.isInteger(value) || value <= 0) {
      return { message: `--${flag} 는 양의 정수여야 합니다: ${raw}` };
    }

    parsedNumbers[key] = value;
  }

  const composition: string | undefined = flagString(args.flags, 'composition');

  if (composition !== undefined && !compositionKinds.includes(composition as CompositionKind)) {
    return { message: `--composition 은 ${compositionKinds.join(', ')} 중 하나여야 합니다.` };
  }

  const episodesRaw: string | undefined = flagString(args.flags, 'episodes');
  const episodeCount: number | undefined =
    episodesRaw === undefined ? undefined : Number(episodesRaw);

  if (episodeCount !== undefined && (!Number.isInteger(episodeCount) || episodeCount <= 0)) {
    return { message: `--episodes 는 양의 정수여야 합니다: ${episodesRaw}` };
  }

  const povCharacters: string[] = (flagString(args.flags, 'pov-characters') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const preset: CompositionPreset | undefined =
    composition === undefined
      ? undefined
      : buildCompositionPreset({
          composition: composition as CompositionKind,
          ...(episodeCount === undefined ? {} : { episodeCount }),
          ...(povCharacters.length > 0 ? { povCharacters } : {}),
          ...(pov === undefined ? {} : { pov: pov as PointOfView }),
        });

  const fromFlags: Partial<ProjectSetting> = {
    ...(flagString(args.flags, 'genre') === undefined
      ? {}
      : { genre: flagString(args.flags, 'genre') }),
    ...(flagString(args.flags, 'audience') === undefined
      ? {}
      : { audience: flagString(args.flags, 'audience') }),
    ...(pov === undefined ? {} : { pov: pov as PointOfView }),
    ...(flagString(args.flags, 'concept') === undefined
      ? {}
      : { concept: flagString(args.flags, 'concept') }),
    ...(flagString(args.flags, 'description') === undefined
      ? {}
      : { description: flagString(args.flags, 'description') }),
    ...parsedNumbers,
    ...(preset?.setting ?? {}),
  };

  const merged: Partial<ProjectSetting> = { ...(fromFile ?? {}), ...fromFlags };

  return {
    setting: Object.keys(merged).length === 0 ? undefined : merged,
    ...(preset && preset.narratorCards.length > 0 ? { narratorCards: preset.narratorCards } : {}),
  };
}

async function readDraftBody(container: CliContainer, stem: string): Promise<string | undefined> {
  try {
    return (await container.drafts.readDraft(container.workspaceRoot, stem))?.draft.body;
  } catch {
    return undefined;
  }
}

const checkDraft: CommandHandler = async ({ container, args }) => {
  const kind: DraftCheckKind | undefined = draftCheckKinds.find(
    (candidate) => candidate === args.positionals[0],
  );
  const stem: string | undefined = sceneStemFrom(args, 1);

  if (kind === undefined) {
    return {
      ok: false,
      message: `검사 종류를 지정해 주세요: storyboard draft check <${draftCheckKinds.join('|')}> <stem>`,
    };
  }

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  const body: string | undefined = await readDraftBody(container, stem);

  if (body === undefined) {
    return { ok: false, message: `초안이 없습니다: ${stem}` };
  }

  const result: CheckDraftResult = await container.drafts.check({
    workspaceRoot: container.workspaceRoot,
    sceneStem: stem,
    kind,
    text: body,
  });

  switch (result.kind) {
    case 'failed':
      return { ok: false, message: result.message };
    case 'slop':
      return {
        ok: result.findings.length === 0,
        message:
          result.findings.length === 0
            ? '상투 표현을 찾지 못했습니다.'
            : `${result.findings.length}건`,
        data: result.findings,
      };
    case 'grammar':
      return {
        ok: result.issues.length === 0,
        message:
          result.issues.length === 0 ? '문법 문제를 찾지 못했습니다.' : `${result.issues.length}건`,
        data: result.issues,
      };
    case 'continuity':
      if (!result.hasFacts) {
        return { ok: true, message: '대조할 정전 사실이 없습니다.', data: [] };
      }

      return {
        ok: result.issues.length === 0,
        message:
          result.issues.length === 0
            ? '연속성 문제를 찾지 못했습니다.'
            : `${result.issues.length}건`,
        data: result.issues,
      };
  }
};

const setApiKey: CommandHandler = async ({ container, args }) => {
  const provider: string | undefined = await resolveApiKeyProvider(container, args.positionals[0]);

  if (typeof provider === 'string' && !availableProviderIds().includes(provider as AiProviderId)) {
    return { ok: false, message: provider };
  }
  if (provider === undefined) {
    return {
      ok: false,
      message: `프로바이더를 지정해 주세요: ${availableProviderIds().join(', ')}`,
    };
  }

  const providerId: AiProviderId = provider as AiProviderId;
  const key: string = (
    process.stdin.isTTY && container.canPrompt
      ? await askSecret(
          `${providerId} API 키를 붙여 넣고 Enter (입력은 화면에 보이지 않습니다. 비워 두면 삭제): `,
        )
      : await readStdin()
  ).trim();

  if (key.length === 0) {
    await container.secretStore.deleteApiKey(providerId);
    return { ok: true, message: `${providerId} API 키를 지웠습니다.` };
  }

  await container.secretStore.setApiKey(providerId, key);

  try {
    await container.aiProviderRegistry.checkConnection(providerId);
    return {
      ok: true,
      message: `${providerId} API 키를 저장하고 연결을 확인했습니다: ${container.homePaths.secretsFile}`,
      data: { providerId, verified: true },
    };
  } catch (error) {
    const reason: string = error instanceof Error ? error.message : String(error);
    return {
      ok: true,
      message: [
        `${providerId} API 키를 저장했지만 연결 확인에 실패했습니다: ${reason}`,
        '키가 맞는지, 네트워크가 닿는지 보고 다시 apikey set 을 실행하세요.',
      ].join('\n'),
      data: { providerId, verified: false },
    };
  }
};

const showApiKeys: CommandHandler = async ({ container }) => {
  const rows: { readonly providerId: AiProviderId; readonly stored: boolean }[] = [];
  const logins: {
    readonly providerId: AiProviderId;
    readonly isLoggedIn: boolean;
    readonly accountLabel: string | null;
    readonly expiresAt: string | null;
  }[] = [];

  for (const providerId of availableProviderIds()) {
    if (requiresApiKey(providerId)) {
      rows.push({ providerId, stored: await container.secretStore.hasApiKey(providerId) });
    } else if (getProviderTransport(providerId) === 'oauth') {
      const connection: OAuthConnection | undefined =
        await container.secretStore.getOAuthConnection(providerId);
      logins.push({
        providerId,
        isLoggedIn: connection?.tokens !== undefined,
        accountLabel: connection?.registration?.email ?? null,
        expiresAt: connection?.tokens?.expiresAt ?? null,
      });
    }
  }

  const describeLogin = (login: (typeof logins)[number]): string => {
    if (!login.isLoggedIn) {
      return `     ${login.providerId}  로그인 안 됨`;
    }
    const account: string = login.accountLabel === null ? '' : ` (${login.accountLabel})`;
    return `  ✅ ${login.providerId}  로그인됨${account}`;
  };

  return {
    ok: true,
    message: [
      `API 키 (${container.homePaths.secretsFile})`,
      ...rows.map(
        (row) =>
          `  ${row.stored ? '✅' : '  '} ${row.providerId}${row.stored ? '  저장됨' : '  없음'}`,
      ),
      ...(logins.length === 0 ? [] : ['', '로그인', ...logins.map(describeLogin)]),
    ].join('\n'),
    data: { keys: rows, logins },
  };
};

async function resolveApiKeyProvider(
  container: CliContainer,
  given: string | undefined,
): Promise<string | undefined> {
  if (given !== undefined) {
    return availableProviderIds().includes(given as AiProviderId)
      ? given
      : `모르는 프로바이더입니다: ${given}\n쓸 수 있는 값: ${availableProviderIds().join(', ')}`;
  }
  if (!process.stdin.isTTY || !container.canPrompt) {
    return undefined;
  }

  const candidates: AiProviderId[] = availableProviderIds().filter((providerId) =>
    requiresApiKey(providerId),
  );
  process.stderr.write('어느 프로바이더의 API 키입니까?\n');
  candidates.forEach((providerId, index) => {
    process.stderr.write(`  ${index + 1}. ${providerId}\n`);
  });
  const answer: string = await askLine('번호 또는 이름: ');
  const byIndex: AiProviderId | undefined = candidates[Number(answer) - 1];

  return byIndex ?? (candidates.includes(answer as AiProviderId) ? answer : undefined);
}

function describeNothingToPromote(kind: 'no_candidates' | 'no_new_candidates'): string {
  return kind === 'no_candidates' ? '승격할 후보가 없습니다.' : '후보가 모두 이미 반영돼 있습니다.';
}

export const commands: Readonly<Record<string, CommandHandler>> = {
  init: initProject,
  setup: runSetup,
  'apikey set': setApiKey,
  'apikey show': showApiKeys,
  login: runLogin,
  logout: runLogout,
  'config show': runConfigShow,
  'config set': runConfigSet,
  'config unset': runConfigUnset,
  'params show': runParamsShow,
  doctor: runDoctor,
  status: showStatus,
  'project show': showProject,
  'project set': setProjectContract,
  'outline generate': generateOutline,
  'narrator list': listNarrators,
  'narrator show': showNarrator,
  'narrator create': createNarrator,
  'narrator remove': removeNarrator,
  'novel generate': generateNovel,
  'scene list': listScenes,
  'scene show': showScene,
  'scene create': createScene,
  'scene rename': renameScene,
  'scene seed': generateSceneSeeds,
  'scene plot': generateSceneBeats,
  'scene complete': completeStory,
  'draft generate': generateScene,
  'draft revise': reviseScene,
  'draft show': showDraft,
  'draft edit': editDraft,
  'draft augment': augmentDraft,
  'draft condense': condenseDraft,
  'draft expand': expandDraft,
  'draft format': applyDraftFormat,
  'draft check': checkDraft,
  'state generate': generateState,
  'state reseal': resealState,
  'card list': listCards,
  'card show': showCard,
  'card create': createCard,
  'card rename': renameCard,
  'card recommend': recommendCards,
  'card build': buildStoryCards,
  'card promote': promoteCards,
  'card discard': discardCardCandidates,
  'canon diff': canonDiff,
  'canon promote': promoteBible,
  'notes connect': connectNotes,
  'notes absorb': absorbNotes,
  'notes export': exportNotes,
  'manuscript assemble': assembleManuscript,
  'manuscript review': reviewManuscript,
  'manuscript summarize': summarizeChapters,
  'manuscript export': exportManuscript,
  'sim run': runSim,
  'sim screen': screenSim,
  'sim sweep': sweepSim,
  'sim report': reportSim,
  'sim rejudge': rejudgeSim,
  'sim apply': applySim,
};
