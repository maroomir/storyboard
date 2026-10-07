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
  type GenerateAllDraftsProgress,
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
  requiresApiKey,
  type AiProviderId,
} from '@storyboard/story-model';

import type { DraftAugmentScope } from '@storyboard/story-ai';
import type { IPrompter } from '@/adapters/prompter';
import type { CliContainer } from '@/container';
import type { WorkspaceStatus } from '@storyboard/story-app';
import { flagBoolean, flagString, type ParsedArguments } from '@/cliArguments';

import { cardCategories, draftCheckKinds, type CardCategory } from './catalog';
import type { CommandHandler, CommandOutcome } from './outcome';
import { absorbNotes, connectNotes, runNoteAbsorb } from './notes';
import { askLine, askSecret, readStdin } from './prompt';
import {
  createNarrator,
  describeSceneNarration,
  listNarrators,
  removeNarrator,
  showNarrator,
} from './narrators';
import { applySim, rejudgeSim, reportSim, runSim, screenSim, sweepSim } from './sim';
import { runConfigSet, runConfigShow, runDoctor, runParamsShow, runSetup } from './setup';
import { showStatus } from './status';
import { listCards, listScenes, showCard, showDraft, showProject } from './views';
import { availableProviderIds } from '@/adapters/availableProviders';

export type { CommandContext, CommandHandler, CommandOutcome } from './outcome';

function sceneStemFrom(args: ParsedArguments, positionalIndex = 0): string | undefined {
  const raw = args.positionals[positionalIndex];
  if (raw === undefined) {
    return undefined;
  }
  const fileName = raw.endsWith('.card') ? raw : `${raw}.card`;
  return parseSceneFileName(fileName)?.stem ?? raw.replace(/\.card$/, '');
}

function sceneUriFor(root: StoryUri, stem: string): StoryUri {
  return scenePath(root, stem);
}

// 한 씬이 10~25분 걸리는데 --verbose 로도 아무 것도 찍히지 않아, 멈춘 것인지 도는 것인지
// 구분할 수 없었다. 엔진은 이미 단계와 구간 번호를 알려 준다. 단계 이름표는 파이프라인의
// 단계 카탈로그가 갖고, 엔진이 그것을 재노출한다.
const sceneStageLabels: Record<string, string> = Object.fromEntries(
  sceneStageCatalog.map((definition) => [definition.id, definition.label]),
);

function describeModel(container: CliContainer): string {
  const { configBridge } = container;
  const provider = configBridge.getDefaultProvider();
  const model = configBridge.getProviderConfig(provider).model;
  return model === undefined ? provider : `${provider} · ${model}`;
}

// The interactive screen asks before a paid batch run; a one-shot command was started on purpose
// and an agent's run must never wait, so both go ahead.
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
  const answer = await prompter.choose({
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

// What the rail shows beside the scene: the pipeline stage while it runs, then saving and review.
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
    const isConfirmed = await confirmPaidRun(container, (status) => {
      const pending = status.drafts.missing + status.drafts.stale;
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

    const result = await container.drafts.generateAll({
      shouldPause: container.pauseRequests.watch(),
      onProgress: (progress) => {
        const step = describeBatchStep(progress);
        container.progress.update({
          // A log line per stage, so each line says which stage it is.
          line: `${progress.current}/${progress.total} ${progress.label} · ${step}`,
          unit: { current: progress.current, total: progress.total, label: progress.label },
          step,
        });
      },
    });

    if (!result.ok) {
      return { ok: false, message: describeBatchFailure(result.kind), data: result };
    }

    // A batch where scenes failed is not a success, however many others went through.
    const { cacheHits, failureLabels, failures, generated, pausedWithRemaining } = result.summary;

    // A pause is not a failure of any scene, but the batch is unfinished, so it does not exit 0.
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

  const stem = sceneStemFrom(args);
  if (stem === undefined) {
    return {
      ok: false,
      message: '씬 stem을 지정해 주세요. 예: storyboard draft generate 01-scene-1-1',
    };
  }

  const result = await container.drafts.generate({
    sceneUri: sceneUriFor(container.workspaceRoot, stem),
    force: flagBoolean(args.flags, 'force'),
    onPipelineProgress: (stage, current, total) => {
      const step = `${sceneStageLabels[stage] ?? stage} ${current}/${total}`;
      container.progress.update({ line: step, step });
    },
  });

  if (!result.ok) {
    return { ok: false, message: result.kind === 'failed' ? result.message : '취소했습니다.' };
  }

  // 초안 앞머리에만 남기면 아무도 보지 않는다. 경고는 stderr로 알리되 생성 자체는 성공이다 —
  // 분량 미달은 모델 편차에서도 나오므로 게이트로 쓰면 정상 결과까지 실패로 만든다. 검수
  // 재작성 뒤에 찍으면 이미 고쳐진 문제를 다시 알리는 꼴이라 생성 직후에 낸다.
  const warnings = result.kind === 'generated' ? result.warnings : [];
  for (const warning of warnings) {
    container.logger.warn(warning);
  }

  // `--no-revise` overrides the setting; without it the workspace's `revise.loop.afterGenerate`
  // decides, exactly as it does in the extension.
  const reviseRequested =
    !flagBoolean(args.flags, 'no-revise') && container.configBridge.isReviseAfterGenerateEnabled();

  if (result.kind === 'generated' && reviseRequested) {
    const revised = await container.drafts.reviseScene(container.workspaceRoot, stem, {
      onProgress: (message) => container.progress.update({ line: message, step: message }),
    });

    // A rejected candidate means the original was kept. Saying nothing would let an unattended run
    // record a revision that never happened.
    if (revised?.preservedOriginal === true && revised.rejection !== undefined) {
      container.logger.warn(
        `검수 재작성 결과가 안전 기준을 통과하지 않아 원본을 유지했습니다 ` +
          `(${revised.rejection.candidateLength}자 / 원본 ${revised.rejection.originalLength}자).`,
      );
    }
  }

  return {
    ok: true,
    message:
      result.kind === 'cache_hit' ? '입력이 같아 기존 초안을 씁니다.' : '초안을 생성했습니다.',
    data: { draft: (result.draftUri as StoryUri).fsPath, warnings },
  };
};

// 비트는 `draft generate` 가 비어 있을 때 자동으로 채우지만, 생성 전에 사건 전개를 검수하려는
// 창작자를 위해 verb 로도 노출한다. --all 은 비트 없는 씬만 고르고, --force 가 있어야 다시 뽑는다.
const generateSceneBeats: CommandHandler = async ({ container, args }) => {
  const force = flagBoolean(args.flags, 'force');
  const dryRun = flagBoolean(args.flags, 'dry-run');

  if (flagBoolean(args.flags, 'all')) {
    const stems = (await container.drafts.listScenes(container.workspaceRoot)).map(
      (scene) => scene.stem,
    );
    const results: Record<string, unknown> = {};
    const failures: string[] = [];
    let proposed = 0;

    for (const stem of stems) {
      const result = await runSceneBeats(container, stem, force, dryRun);
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

  const stem = sceneStemFrom(args);
  if (stem === undefined) {
    return {
      ok: false,
      message: '씬 stem을 지정해 주세요. 예: storyboard scene plot 01-scene-1-1',
    };
  }

  const result = await runSceneBeats(container, stem, force, dryRun);
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
  const stem = sceneStemFrom(args);
  if (stem === undefined) {
    return { ok: false, message: '씬 stem을 지정해 주세요.' };
  }

  const result = await container.drafts.reviseScene(container.workspaceRoot, stem);
  return result === undefined
    ? { ok: false, message: '초안이 없어 검수를 건너뛰었습니다.' }
    : { ok: true, message: '검수와 재작성을 마쳤습니다.', data: result };
};

const generateOutline: CommandHandler = async ({ container, args }) => {
  const result = await container.novel.generateOutline({
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
  const result = await container.manuscript.assemble({
    workspaceRoot: container.workspaceRoot,
  });
  return {
    ok: result.ok,
    message: result.ok ? '원고를 조립했습니다.' : '조립하지 못했습니다.',
    data: result,
  };
};

const reviewManuscript: CommandHandler = async ({ container }) => {
  const result = await container.manuscript.review({
    workspaceRoot: container.workspaceRoot,
  });
  return {
    ok: result.ok,
    message: result.ok ? '원고 검사를 마쳤습니다.' : '검사하지 못했습니다.',
    data: result,
  };
};

const summarizeChapters: CommandHandler = async ({ container }) => {
  const result = await container.manuscript.summarizeChapters({
    workspaceRoot: container.workspaceRoot,
  });
  return {
    ok: result.ok,
    message: result.ok ? '장별 요약을 만들었습니다.' : '요약하지 못했습니다.',
    data: result,
  };
};

const generateNovel: CommandHandler = async ({ container, args }) => {
  // NOTE: 이 명령은 실행 잠금을 쥔 채 돈다. 그러니 running 으로 남은 상태는 죽은 프로세스의 것이다.
  const interrupted = await container.novel.findResumableRun(container.workspaceRoot, {
    holdsRunLock: true,
  });
  const restartChoice =
    interrupted === undefined
      ? 'restart'
      : await askResumeOrRestart(container.prompter, interrupted);

  if (restartChoice === undefined) {
    return cancelledBeforeRun;
  }

  const isConfirmed = await confirmPaidRun(container, (status) => ({
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

  const project = await container.novel.readProject(container.workspaceRoot);
  const novelPlan = resolveNovelPipelinePlan();
  const reviseIterations = flagString(args.flags, 'revise-iterations');
  const result = await container.novel.run({
    workspaceUri: container.workspaceRoot,
    project,
    // Every gate is auto-approved: a CLI run is unattended, and stopping to ask would stall a queue.
    runMode: 'auto',
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
  const budgetNote =
    result.outcome === 'paused' && spending.isOverBudget
      ? ` 이번 실행 예산 $${spending.budgetUsd}에 닿았습니다 (쓴 비용 $${spending.costUsd.toFixed(2)}).`
      : '';

  return {
    ok: result.outcome === 'completed',
    message:
      result.outcome === 'failed'
        ? `장편 생성에 실패했습니다: ${result.message}`
        : `${result.message}${budgetNote}`,
    data: { ...result, costUsd: spending.costUsd },
    ...(result.outcome === 'paused' || result.outcome === 'cancelled'
      ? { stop: result.outcome }
      : {}),
  };
};

// 끊긴 실행이 있을 때 사람에게만 묻는다. 에이전트·파이프·--json 은 프롬프터가 없어 묻지 않고 이어 간다.
// 한 번 실행하는 명령에 질문을 더하지 않는다는 원칙의 예외다: 잘못 고르면 쓴 돈이 버려진다.
// «처음부터»도 있는 아웃라인과 씬 카드는 그대로 쓴다. 실행 기록만 새로 시작한다.
async function askResumeOrRestart(
  prompter: IPrompter | undefined,
  interrupted: NovelRunState,
): Promise<'resume' | 'restart' | undefined> {
  if (prompter === undefined) {
    return 'resume';
  }

  const finished = interrupted.completedStages.map((stage) => novelStageLabel(stage)).join(', ');

  return await prompter.choose<'resume' | 'restart'>({
    title: '끊긴 장편 생성이 있습니다',
    details: [`끝난 단계  ${finished.length === 0 ? '없음' : finished}`],
    options: [
      { label: '이어 가기', value: 'resume' },
      { label: '처음부터 (있는 아웃라인·씬 카드는 그대로 씀)', value: 'restart' },
    ],
  });
}

// 파생이 어떻게 됐는지 확인하는 자리. 서술자 카드를 만들지 않은 작품도 계약의 시점 하나가 어떤
// 서술로 풀리는지 여기서 볼 수 있다.
const showScene: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  const scene = await container.drafts.readScene(container.workspaceRoot, stem);

  if (scene === undefined) {
    return { ok: false, message: `씬을 찾을 수 없습니다: ${stem}` };
  }
  const narration = await describeSceneNarration(
    container,
    scene.card.narrator,
    scene.frontmatter.povCharacter,
  );
  const thread = scene.card.thread ?? mainThreadId;

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

// An unattended run has nobody to pick from a list, so promotion applies everything the prepare
// step judged new. `--dry-run` is how an agent inspects first.
// Candidates come from two places — facts generation pulled out of drafts, and notes about cards
// that already existed — and the author promotes both with this one verb.
const promoteCards: CommandHandler = async ({ container, args }) => {
  const prepared = await container.cards.prepareCandidatePromotion(container.workspaceRoot);
  const preparedNotes = await container.notes.prepareCandidatePromotion(container.workspaceRoot);

  if (prepared.kind !== 'ready' && preparedNotes.kind !== 'ready') {
    const kind =
      prepared.kind === 'no_candidates' && preparedNotes.kind === 'no_candidates'
        ? 'no_candidates'
        : 'no_new_candidates';
    return { ok: true, message: describeNothingToPromote(kind), data: { kind } };
  }

  const draftItems = prepared.kind === 'ready' ? prepared.items : [];
  const noteCandidates = preparedNotes.kind === 'ready' ? preparedNotes.candidates : [];

  if (flagBoolean(args.flags, 'dry-run')) {
    return {
      ok: true,
      message: [
        `승격 후보 ${draftItems.length + noteCandidates.length}건`,
        ...(draftItems.length > 0 ? [`  초안에서  ${draftItems.length}건`] : []),
        ...noteCandidates.map(
          (candidate) =>
            `  노트에서  ${candidate.cardId} (${candidate.name}) 변경 ${candidate.changes.length}건`,
        ),
      ].join('\n'),
      data: { drafts: draftItems, notes: noteCandidates },
    };
  }

  const result =
    draftItems.length > 0
      ? await container.cards.promoteCandidates(container.workspaceRoot, draftItems)
      : undefined;
  const noteResult =
    noteCandidates.length > 0
      ? await container.notes.promoteCandidates(container.workspaceRoot, noteCandidates)
      : undefined;
  const isDraftSaveFailed = result !== undefined && result.kind !== 'promoted';
  const updatedCardCount =
    (result?.kind === 'promoted' ? result.updatedCardCount : 0) +
    (noteResult?.updatedCardIds.length ?? 0);

  return {
    ok: !isDraftSaveFailed,
    message: isDraftSaveFailed
      ? '카드를 저장하지 못했습니다.'
      : `카드 ${updatedCardCount}개를 갱신했습니다.`,
    data: { drafts: result ?? null, notes: noteResult ?? null },
  };
};

const promoteBible: CommandHandler = async ({ container, args }) => {
  const prepared = await container.cards.prepareBiblePromotion(container.workspaceRoot);

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

// Read-only: an agent uses this to decide whether a card is worth creating, so it never writes.
const recommendCards: CommandHandler = async ({ container, args }) => {
  const category = cardCategoryFrom(args);

  if (category === undefined) {
    return { ok: false, message: describeMissingCardCategory('card recommend') };
  }

  const result = await container.cards.recommend({
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

const cardIdPattern = /^[a-z0-9][a-z0-9-]*$/;

function cardCategoryFrom(args: ParsedArguments): CardCategory | undefined {
  return cardCategories.find((category) => category === args.positionals[0]);
}

function describeMissingCardCategory(verb: string): string {
  return `카드 종류를 지정해 주세요: storyboard ${verb} <${cardCategories.join('|')}>`;
}

const renameCard: CommandHandler = async ({ container, args }) => {
  const category = cardCategoryFrom(args);
  const fromId = args.positionals[1];
  const toId = flagString(args.flags, 'to');

  if (category === undefined) {
    return { ok: false, message: describeMissingCardCategory('card rename') };
  }

  if (fromId === undefined || toId === undefined) {
    return { ok: false, message: '바꿀 id 와 --to <새 id> 를 지정해 주세요.' };
  }

  const result = await container.cards.rename({
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

// The editor names a region by dragging; a terminal names it by line numbers. `--lines 40-60` is
// the same input in the form this host has.
interface LineRange {
  readonly from: number;
  readonly to: number;
}

function parseLineRange(raw: string | undefined): LineRange | undefined | 'invalid' {
  if (raw === undefined) {
    return undefined;
  }

  const match = /^(\d+)-(\d+)$/.exec(raw.trim());

  if (!match) {
    return 'invalid';
  }

  const from = Number(match[1]);
  const to = Number(match[2]);
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

  const lines = body.split('\n');
  return [
    ...lines.slice(0, range.from - 1),
    ...replacement.split('\n'),
    ...lines.slice(range.to),
  ].join('\n');
}

// Rewrites the draft in place. `--lines` narrows it; without one the whole body is the target,
// which is the shape a terminal caller usually wants.
async function rewriteDraft(
  container: CliContainer,
  stem: string,
  range: LineRange | undefined,
  transform: (target: string) => Promise<{ ok: boolean; text?: string; message: string }>,
): Promise<CommandOutcome> {
  const body = await readDraftBody(container, stem);

  if (body === undefined) {
    return { ok: false, message: `초안이 없습니다: ${stem}` };
  }

  const target = sliceLines(body, range);

  if (target.trim().length === 0) {
    return { ok: false, message: '대상 구간이 비어 있습니다.' };
  }

  const result = await transform(target);

  if (!result.ok || result.text === undefined) {
    return { ok: false, message: result.message };
  }

  // 손질 한 번이 한 편집 세션이다. 고치기 전 판본은 편집기에서처럼 .draft/ 에 남는다.
  const saved = await container.drafts.saveEdit({
    workspaceRoot: container.workspaceRoot,
    sceneStem: stem,
    body: replaceLines(body, range, result.text),
    archivePrevious: true,
  });

  if (!saved.ok) {
    return { ok: false, message: `초안이 없습니다: ${stem}` };
  }

  const draftUri = draftPath(container.workspaceRoot, stem);

  return { ok: true, message: result.message, data: { draft: draftUri.fsPath } };
}

function rangeFrom(args: ParsedArguments): LineRange | undefined | 'invalid' {
  return parseLineRange(flagString(args.flags, 'lines'));
}

const condenseDraft: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);
  const range = rangeFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  if (range === 'invalid') {
    return { ok: false, message: '--lines 는 40-60 형식이어야 합니다.' };
  }

  const project = await container.novel.readProject(container.workspaceRoot);

  return rewriteDraft(container, stem, range, async (target) => {
    const result = await container.drafts.condense({
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
  const stem = sceneStemFrom(args);
  const range = rangeFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  if (range === 'invalid') {
    return { ok: false, message: '--lines 는 40-60 형식이어야 합니다.' };
  }

  return rewriteDraft(container, stem, range, async (target) => {
    const result = await container.drafts.expand({
      workspaceRoot: container.workspaceRoot,
      sceneStem: stem,
      selectedText: target,
    });

    return result.ok
      ? { ok: true, text: result.text, message: '구간을 늘렸습니다.' }
      : { ok: false, message: `늘리지 못했습니다 (${result.kind}).` };
  });
};

// Seeds come from the outline, so an agent runs `outline generate` first. Overwriting is what the
// editor asks about with a modal; unattended, it is refused unless `--force` says so.
const generateSceneSeeds: CommandHandler = async ({ container, args }) => {
  const result = await container.novel.seedScenes({
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

// 익스텐션은 제안을 QuickPick 으로 고르고 diff 로 검토한 뒤 쓴다. 무인 실행에는 그 자리가 없으니
// 제안 전체를 적용하고, 미리 보려면 --dry-run 을 쓴다 — card promote 와 같은 관례다.
const completeStory: CommandHandler = async ({ container, args }) => {
  const proposal = await container.novel.completeScenes({
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
  const proposal = await container.cards.buildFromScenes({
    workspaceRoot: container.workspaceRoot,
  });

  if (flagBoolean(args.flags, 'dry-run')) {
    return { ok: true, message: `카드 구성안 ${proposal.targets.length}건`, data: proposal };
  }

  // 이름에서 id 를 못 만드는 새 카드는 익스텐션이 사람에게 물어보는 자리다. 짐작해 id 를 박아
  // 넣는 대신 이름을 돌려받아, card create --id 를 거치게 한다.
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
  const canon = await container.cards.bibleCandidates.loadCanon(container.workspaceRoot);
  const candidates = await container.cards.bibleCandidates.loadRecords(container.workspaceRoot);
  const { pending } = diffCandidatesAgainstCanon(canon, candidates);

  return {
    ok: true,
    message:
      pending.length === 0 ? '정전과 어긋나는 후보가 없습니다.' : `미승격 후보 ${pending.length}건`,
    data: pending,
  };
};

// Cards start empty and get filled by the studio or by hand; creating one is a file write, not a
// generation, so no provider is involved.
const createCard: CommandHandler = async ({ container, args }) => {
  const kind = cardCategoryFrom(args);
  const name = flagString(args.flags, 'name') ?? args.positionals[1];

  if (kind === undefined) {
    return { ok: false, message: describeMissingCardCategory('card create') };
  }

  if (name === undefined || name.trim().length === 0) {
    return { ok: false, message: '--name 으로 이름을 지정해 주세요.' };
  }

  const cardType = kind === 'character' ? 'character' : 'location';
  const suggested = flagString(args.flags, 'id') ?? slugify(name);

  // 한글 이름은 ascii 슬러그를 내지 못한다. 예전에는 이때 new-card, new-card-2 로 번호를 붙여
  // 이름과 무관한 id 가 조용히 만들어졌고, 씬 카드가 그 id 로 인물을 참조했다. 짐작하는 대신
  // 거부하고 --id 를 요구한다.
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

  const id = await container.cards.deriveUniqueId(
    container.workspaceRoot,
    cardType,
    suggested,
    suggested,
  );
  const card =
    kind === 'character'
      ? createEmptyCharacter(id, name.trim())
      : createEmptyBackground(id, name.trim());
  const uri = await container.cards.write(container.workspaceRoot, card);

  return {
    ok: true,
    message: `${id} 카드를 만들었습니다.`,
    data: { id, path: (uri as StoryUri).fsPath },
  };
};

// 씬은 번호가 정체성을 지니므로 이름에서 슬러그를 못 만들어도 거부하지 않는다. 그때는 엔진이
// sceneSeedFactory 의 폴백과 같은 `scene-<번호>` 로 붙인다.
const createScene: CommandHandler = async ({ container, args }) => {
  const name = flagString(args.flags, 'name') ?? args.positionals[0];

  if (name === undefined || name.trim().length === 0) {
    return { ok: false, message: '--name 으로 씬 이름을 지정해 주세요.' };
  }

  const slug = slugify(name);
  const result = await container.drafts.createScene({
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

// The stem is the scene's key: the engine moves every file named after it and rewrites the
// ledgers, canon and caches that point at it. A number another scene holds is refused.
const renameScene: CommandHandler = async ({ container, args }) => {
  const fromStem = args.positionals[0];
  const toStem = flagString(args.flags, 'to');

  if (fromStem === undefined || toStem === undefined) {
    return { ok: false, message: '바꿀 씬과 --to <새 이름> 을 지정해 주세요.' };
  }

  const result = await container.drafts.renameScene({
    workspaceRoot: container.workspaceRoot,
    fromStem,
    toStem,
  });

  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  const orderNote = result.hasOrderChanged
    ? ' 번호가 바뀌었으므로 아웃라인의 자리와 장 배정도 새 번호를 따릅니다.'
    : '';

  return {
    ok: true,
    message: `${result.fromStem} → ${result.toStem} (옮긴 파일 ${result.movedFiles.length}개, 고친 파일 ${result.rewrittenFiles.length}개).${orderNote}`,
    data: result,
  };
};

// Card ids are file names, so they stay ascii-safe and lowercase. A name with no ascii yields
// nothing usable; the caller refuses rather than inventing a name-shaped id.
function slugify(name: string): string | undefined {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : undefined;
}

const applyDraftFormat: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  const result = await container.drafts.applyFormat({
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

// Card-based augmentation rewrites the whole draft from updated cards and canon, without
// regenerating it. The editor shows a diff first; unattended, the caller asked for it, so it lands.
const augmentDraft: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);
  const range = rangeFrom(args);

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

// The editor asks for the instruction in a prompt box; here it is a flag. Everything else is the
// selection-scoped augmentation the editor runs.
const editDraft: CommandHandler = async ({ container, args }) => {
  const stem = sceneStemFrom(args);
  const range = rangeFrom(args);
  const instruction = flagString(args.flags, 'instruction');

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
  const prepare = (target: string) =>
    container.drafts.prepareAugmentation({
      draftSceneStem: stem,
      sceneUri: scenePath(container.workspaceRoot, stem),
      scope: options.scope,
      target,
      workspaceRoot: container.workspaceRoot,
      ...(options.instruction === undefined ? {} : { instruction: options.instruction }),
    });

  if (options.isDryRun) {
    const body = await readDraftBody(container, stem);

    if (body === undefined) {
      return { ok: false, message: `초안이 없습니다: ${stem}` };
    }

    const prepared = await prepare(sliceLines(body, range));

    return prepared.ok
      ? { ok: true, message: options.proposedMessage, data: prepared }
      : { ok: false, message: `${options.failedLabel} (${prepared.kind}).`, data: prepared };
  }

  return rewriteDraft(container, stem, range, async (target) => {
    const prepared = await prepare(target);

    return prepared.ok
      ? { ok: true, text: prepared.text, message: options.appliedMessage }
      : { ok: false, message: `${options.failedLabel} (${prepared.kind}).` };
  });
}

const exportManuscript: CommandHandler = async ({ container, args }) => {
  const source = await container.manuscript.loadExportSource(container.workspaceRoot);

  if (!source.ok) {
    return { ok: false, message: `내보낼 원고가 없습니다 (${source.kind}).`, data: source };
  }

  const target = flagString(args.flags, 'out');

  if (target === undefined) {
    process.stdout.write(source.markdown);
    return { ok: true, message: '', data: { projectName: source.projectName } };
  }

  // 편집기의 형식 선택과 같은 두 형식이다. 확장자가 .txt 면 마크다운 기호를 걷어 낸 평문으로 낸다.
  const format = target.toLowerCase().endsWith('.txt') ? 'txt' : 'md';
  const exported = await container.manuscript.writeExport(
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

// An agent starting from an empty directory needs this first; without it the CLI can only work in
// 0.8 이전 원장에는 씬 입력 해시가 없어 낡음을 판정할 근거가 없다. 보수 시점의 카드·씬을
// 기준으로 삼는다 — 그 뒤에 고친 것부터 낡음으로 잡힌다.
async function sealWorkspaceStoryState(
  container: CliContainer,
  paths: ReturnType<typeof getStoryboardProjectPaths>,
): Promise<readonly number[]> {
  const project = await readProjectJson(container.fileSystem, paths.projectJson).catch(
    () => undefined,
  );

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

// "5", "5-8", "5,7,9" 를 받는다. 형식이 어긋나면 undefined 로 알려 조용히 전체를 봉인하는 일을 막는다.
function parseSceneOrders(raw: string): readonly number[] | undefined {
  const orders = new Set<number>();

  for (const part of raw.split(',')) {
    const bounds = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    const start = Number(bounds?.[1]);

    if (bounds === undefined || bounds === null || !Number.isInteger(start)) {
      return undefined;
    }

    const end = bounds[2] === undefined ? start : Number(bounds[2]);

    if (end < start) {
      return undefined;
    }

    for (let order = start; order <= end; order += 1) {
      orders.add(order);
    }
  }

  return [...orders];
}

// 낡음 판정은 옳다. 사람이 "카드는 고쳤지만 이 초안이 맞다"고 판단했을 때 그 판단을 원장에 남기는
// 유일한 통로이므로, 자동으로 도는 곳이 없고 이 명령만 덮어쓴다.
const resealState: CommandHandler = async ({ container, args }) => {
  const rawOrders = args.positionals[0];
  const sceneOrders = rawOrders === undefined ? undefined : parseSceneOrders(rawOrders);

  if (rawOrders !== undefined && sceneOrders === undefined) {
    return {
      ok: false,
      message: `씬 범위를 알아볼 수 없습니다: ${rawOrders}\n  5 · 5-8 · 5,7,9 처럼 적어 주세요.`,
    };
  }

  const resealed = await container.drafts.resealStoryState(container.workspaceRoot, sceneOrders);

  return {
    ok: true,
    message:
      resealed.length === 0
        ? '다시 봉인할 낡은 항목이 없습니다.'
        : `씬 ${formatSceneOrderRanges(resealed)}의 원장 항목을 지금의 카드·씬으로 다시 봉인했습니다.`,
    data: { sceneOrders: resealed },
  };
};

// a workspace the extension already created.
const initProject: CommandHandler = async ({ container, args }) => {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);

  // `--repair` 는 계약은 손대지 않고 발판(디렉터리·.gitignore)만 채운다. 0.8 이전에 만든
  // 워크스페이스에는 생성물 무시 항목이 빠져 있어 원고가 통째로 커밋 대상에 남는다. 플래그 없이
  // 기존 워크스페이스에 오면 거부해, --title 이 조용히 무시된 채 exit 0 이 되는 일을 막는다.
  const isExistingWorkspace = await container.fileSystem.exists(paths.projectJson);

  if (flagBoolean(args.flags, 'repair')) {
    if (!isExistingWorkspace) {
      return {
        ok: false,
        message: 'Storyboard 워크스페이스가 아닙니다: storyboard init --title "작품 이름"',
      };
    }

    await createStoryboardDirectories(container.fileSystem, paths);
    await ensureWorkspaceGitignore(container.fileSystem, paths.gitignore);
    const addedAgentGuides = await writeWorkspaceAgentGuidesIfMissing(container.fileSystem, paths);
    const gitRepository = ensureGitRepository(container.workspaceRoot.fsPath);
    const sealedSceneOrders = await sealWorkspaceStoryState(container, paths);

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

  const name = flagString(args.flags, 'title') ?? args.positionals[0];
  const hasName = name !== undefined && name.trim().length > 0;

  // A person at a terminal is asked instead of being told to start over with flags.
  if (!hasName && container.prompter !== undefined) {
    const answers = await askInitContract(container.prompter, args);

    return answers === undefined
      ? { ok: false, message: '취소했습니다. 아무것도 만들지 않았습니다.', stop: 'cancelled' }
      : initProject({ container, args: { ...args, flags: { ...args.flags, ...answers } } });
  }

  if (!hasName) {
    return {
      ok: false,
      message: '작품 이름이 필요합니다: storyboard init --title "작품 이름"',
    };
  }

  const contract = await readContractInput(container, args);

  if ('message' in contract) {
    return { ok: false, message: contract.message };
  }

  const language = flagString(args.flags, 'language');
  const setting =
    contract.setting === undefined ? undefined : mergeProjectSetting(undefined, contract.setting);
  const { project, createdNarrators } = await createWorkspace({
    fileSystem: container.fileSystem,
    workspaceRoot: container.workspaceRoot,
    name,
    ...(language === undefined ? {} : { language }),
    ...(setting === undefined ? {} : { setting }),
    narratorCards: contract.narratorCards ?? [],
  });
  const gitRepository = ensureGitRepository(container.workspaceRoot.fsPath);
  const fromNotes = flagString(args.flags, 'from-notes');

  if (fromNotes !== undefined) {
    const absorbed = await runNoteAbsorb(container, args, fromNotes, {
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
    // NOTE: 다음 단계는 dispatch 가 현황(status)에서 읽어 터미널에 덧붙인다. 계약을 플래그로 채운
    // init 에게 «계약을 채우라» 고 하지 않도록 여기서는 적지 않는다.
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

// The ignore block is in place before the repository exists, so nothing generated can slip into the
// user's first commit; the CLI itself never makes that commit.
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

// 계약은 outline generate 의 입구다. 이걸 채우는 길이 없으면 워크스페이스를 만들고도 CLI 만으로는
// 한 걸음도 못 나간다. init 이 처음 채우고, project set 이 나중에 고친다 — 둘 다 같은 입력을 읽는다.
const setProjectContract: CommandHandler = async ({ container, args }) => {
  const contract = await readContractInput(container, args);

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

  const updated = await container.novel.updateContract({
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
      // 구성 프리셋이 함께 만들라고 내놓은 서술자 카드. init·project set 이 워크스페이스에 쓴다.
      readonly narratorCards?: readonly NarratorCard[];
    }
  | { readonly message: string };

// The onboarding rail: the name, then each contract choice the flags did not already make. A
// skipped answer leaves that field for `project set` later; backing out at any step creates nothing.
async function askInitContract(
  prompter: IPrompter,
  args: ParsedArguments,
): Promise<Record<string, string> | undefined> {
  const later = '';
  prompter.announce('┌  새 작품 만들기');

  const title = await prompter.askText({ title: '작품 이름' });
  if (title === undefined || title.length === 0) {
    return undefined;
  }
  prompter.announce(`◇  작품 이름  › ${title}`);
  const answers: Record<string, string> = { title };

  if (flagString(args.flags, 'genre') === undefined) {
    const genre = await prompter.askText({ title: '장르', hint: '비우면 나중에' });
    if (genre === undefined) {
      return undefined;
    }
    prompter.announce(`◇  장르  › ${genre.length > 0 ? genre : '나중에'}`);
    if (genre.length > 0) {
      answers.genre = genre;
    }
  }

  if (flagString(args.flags, 'pov') === undefined) {
    const pov = await prompter.choose<string>({
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
    const composition = await prompter.choose<CompositionKind>({
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
  const fromPath = flagString(args.flags, 'from');
  let fromFile: Partial<ProjectSetting> | undefined;

  if (fromPath !== undefined) {
    try {
      const bytes = await container.fileSystem.readFile(NodeUri.file(resolve(fromPath)));
      const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { message: `${fromPath} 의 최상위는 객체여야 합니다.` };
      }

      // setting 을 감싼 project.json 을 그대로 줘도 받는다.
      const record = parsed as Record<string, unknown>;
      fromFile = (record.setting ?? record) as Partial<ProjectSetting>;
    } catch (error) {
      return {
        message: `${fromPath} 를 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const pov = flagString(args.flags, 'pov');

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
    const raw = flagString(args.flags, flag);

    if (raw === undefined) {
      continue;
    }

    const value = Number(raw);

    if (!Number.isInteger(value) || value <= 0) {
      return { message: `--${flag} 는 양의 정수여야 합니다: ${raw}` };
    }

    parsedNumbers[key] = value;
  }

  const composition = flagString(args.flags, 'composition');

  if (composition !== undefined && !compositionKinds.includes(composition as CompositionKind)) {
    return { message: `--composition 은 ${compositionKinds.join(', ')} 중 하나여야 합니다.` };
  }

  const episodesRaw = flagString(args.flags, 'episodes');
  const episodeCount = episodesRaw === undefined ? undefined : Number(episodesRaw);

  if (episodeCount !== undefined && (!Number.isInteger(episodeCount) || episodeCount <= 0)) {
    return { message: `--episodes 는 양의 정수여야 합니다: ${episodesRaw}` };
  }

  const povCharacters = (flagString(args.flags, 'pov-characters') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  // 프리셋이 줄기와 서술자 카드를 만든다. 창작자는 구성 하나만 고르면 된다.
  const preset =
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

  const merged = { ...(fromFile ?? {}), ...fromFlags };

  return {
    setting: Object.keys(merged).length === 0 ? undefined : merged,
    ...(preset && preset.narratorCards.length > 0 ? { narratorCards: preset.narratorCards } : {}),
  };
}

// Diagnostics the editor paints as squiggles have no terminal form, but the analysis behind them
// does — and an agent that can check its own output is the whole point of the CLI. Findings go out
// as data; the exit code says whether the draft is clean.

async function readDraftBody(container: CliContainer, stem: string): Promise<string | undefined> {
  try {
    return (await container.drafts.readDraft(container.workspaceRoot, stem))?.draft.body;
  } catch {
    return undefined;
  }
}

const checkDraft: CommandHandler = async ({ container, args }) => {
  const kind = draftCheckKinds.find((candidate) => candidate === args.positionals[0]);
  const stem = sceneStemFrom(args, 1);

  if (kind === undefined) {
    return {
      ok: false,
      message: `검사 종류를 지정해 주세요: storyboard draft check <${draftCheckKinds.join('|')}> <stem>`,
    };
  }

  if (stem === undefined) {
    return { ok: false, message: '씬 stem 을 지정해 주세요.' };
  }

  const body = await readDraftBody(container, stem);

  if (body === undefined) {
    return { ok: false, message: `초안이 없습니다: ${stem}` };
  }

  const result = await container.drafts.check({
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

// SECURITY: the key is read from stdin or a hidden prompt, never from argv — an API key on a
// command line lands in the shell history and in the process list for every user on the machine.
const setApiKey: CommandHandler = async ({ container, args }) => {
  const provider = await resolveApiKeyProvider(container, args.positionals[0]);

  if (typeof provider === 'string' && !availableProviderIds().includes(provider as AiProviderId)) {
    return { ok: false, message: provider };
  }
  if (provider === undefined) {
    return {
      ok: false,
      message: `프로바이더를 지정해 주세요: ${availableProviderIds().join(', ')}`,
    };
  }

  const providerId = provider as AiProviderId;
  const key = (
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

  // 저장하자마자 한 번 불러 본다. 키를 잘못 붙여 넣은 것을 첫 실제 호출에서 알게 되면 늦다.
  try {
    await container.aiProviderRegistry.checkConnection(providerId);
    return {
      ok: true,
      message: `${providerId} API 키를 저장하고 연결을 확인했습니다: ${container.homePaths.secretsFile}`,
      data: { providerId, verified: true },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
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

// 어느 키가 들어 있는지만 보여 준다. 값은 절대 찍지 않는다.
const showApiKeys: CommandHandler = async ({ container }) => {
  const rows: { readonly providerId: AiProviderId; readonly stored: boolean }[] = [];

  for (const providerId of availableProviderIds()) {
    if (!requiresApiKey(providerId)) {
      continue;
    }
    rows.push({ providerId, stored: await container.secretStore.hasApiKey(providerId) });
  }

  return {
    ok: true,
    message: [
      `API 키 (${container.homePaths.secretsFile})`,
      ...rows.map(
        (row) =>
          `  ${row.stored ? '✅' : '  '} ${row.providerId}${row.stored ? '  저장됨' : '  없음'}`,
      ),
    ].join('\n'),
    data: { keys: rows },
  };
};

// 프로바이더를 안 적었으면 터미널에서 번호로 고르게 한다. 파이프에서는 물을 수 없으니 그대로 거절한다.
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

  const candidates = availableProviderIds().filter((providerId) => requiresApiKey(providerId));
  process.stderr.write('어느 프로바이더의 API 키입니까?\n');
  candidates.forEach((providerId, index) => {
    process.stderr.write(`  ${index + 1}. ${providerId}\n`);
  });
  const answer = await askLine('번호 또는 이름: ');
  const byIndex = candidates[Number(answer) - 1];

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
  'config show': runConfigShow,
  'config set': runConfigSet,
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
  'state reseal': resealState,
  'card list': listCards,
  'card show': showCard,
  'card create': createCard,
  'card rename': renameCard,
  'card recommend': recommendCards,
  'card build': buildStoryCards,
  'card promote': promoteCards,
  'canon diff': canonDiff,
  'canon promote': promoteBible,
  'notes connect': connectNotes,
  'notes absorb': absorbNotes,
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
