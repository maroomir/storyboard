import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  storyboardModelCatalog,
  parseSceneCard,
  parseSceneFileName,
  extractErrorMessage,
} from '@storyboard/story-model';
import type { AiProviderId, SceneCard, SceneFileNameParts } from '@storyboard/story-model';
import {
  promptVariantIds,
  type AiProviderRegistry,
  type PromptVariantId,
} from '@storyboard/story-ai';
import {
  appendRun,
  applyOverlay,
  completedKeys,
  copyToScratch,
  createFactRecallJudge,
  createSimJudge,
  judgeAxis,
  judgeChain,
  keepDrafts,
  measurementFor,
  profileFieldsFor,
  writeModelProfile,
  parseFactLedger,
  scoreFactRecall,
  defaultGridLevels,
  describeCost,
  describeEngine,
  describeTrack,
  estimateBudget,
  findKnob,
  knobRegistry,
  listLocalModels,
  missingLocalModels,
  chooseCostAxis,
  costAxisLabels,
  paretoFrontier,
  planFractionalGrid,
  planScreening,
  parseOverlay,
  promptVariantSchema,
  isJudged,
  readRuns,
  rejudgeSources,
  rejudgedRecord,
  summarizeUsage,
  removeScratch,
  scoreRuns,
  regressionRows,
  describeRegression,
  runKey,
  runTrack,
  readSimConfig,
  simConfigFileName,
  simDefaults,
  simResultsDirectory,
  withinCap,
  type DesignedPoint,
  type PointScore,
  type RunRecord,
  type SimConfig,
  type SimJudge,
  type TokenTotals,
  type BudgetEstimate,
  type TrackRef,
  type ISimWorkspaceFactory,
  type TrackRunResult,
  type AxisVerdict,
  type PanelVerdict,
  type FactRecallReport,
  type KnobSpec,
  type RegressionRow,
  type CostAxis,
  type ScoredPoint,
  type RejudgeSource,
  type ProfileMeasurement,
  type ProfileWriteResult,
  type Overlay,
  type BaselineSample,
} from '@storyboard/story-sim';

import { flagBoolean, flagString } from '@/cliArguments';
import { createSimWorkspaceFactory } from '@/adapters/simWorkspaceFactory';
import { createCliContainer } from '@/container';
import type { CommandContext, CommandHandler, CommandOutcome } from './outcome';
import { availableProviderIds, isAvailableProviderId } from '@/adapters/availableProviders';
import type { ZodSafeParseResult } from 'zod';

interface TrackScene {
  readonly sceneStem: string;
  readonly targetLength: number;
  readonly title: string;
  readonly purpose: string;
}

interface JudgeMaterials {
  readonly genre: string;
  readonly characterNames: readonly string[];
  readonly floorDraft: { readonly sceneStem: string; readonly text: string };
  readonly ledger: ReturnType<typeof parseFactLedger> | undefined;
  readonly axisFloors?: ReadonlyMap<string, string>;
}

function requireFlag(context: CommandContext, name: string): string | undefined {
  return flagString(context.args.flags, name);
}

function refuse(message: string): CommandOutcome {
  return { ok: false, message };
}

async function readTrackScenes(genreRoot: string): Promise<readonly TrackScene[]> {
  const sceneDirectory: string = join(genreRoot, 'scene');
  const names: string[] = (await readdir(sceneDirectory)).filter((name) =>
    parseSceneFileName(name),
  );
  const scenes: TrackScene[] = [];

  for (const name of names.sort()) {
    const parts: SceneFileNameParts | undefined = parseSceneFileName(name);
    const card: SceneCard = parseSceneCard(await readFile(join(sceneDirectory, name), 'utf8'));

    if (parts === undefined) {
      continue;
    }

    if (card.targetWordCount === undefined) {
      throw new Error(
        `${name} 에 targetWordCount 가 없습니다. 트랙 카드는 목표 분량을 적어야 합니다.`,
      );
    }

    scenes.push({
      sceneStem: parts.stem,
      targetLength: card.targetWordCount,
      title: card.title ?? parts.stem,
      purpose: card.purpose ?? '',
    });
  }

  if (scenes.length === 0) {
    throw new Error(`${sceneDirectory} 에 씬 카드가 없습니다.`);
  }

  return scenes;
}

async function readAxisFloors(
  genreRoot: string,
  scenes: readonly TrackScene[],
): Promise<ReadonlyMap<string, string>> {
  const floors: Map<string, string> = new Map<string, string>();
  for (const scene of scenes) {
    try {
      floors.set(
        scene.sceneStem,
        await readFile(join(genreRoot, 'floor', `${scene.sceneStem}.md`), 'utf8'),
      );
    } catch {
      continue;
    }
  }
  return floors;
}

async function readCharacterNames(genreRoot: string): Promise<readonly string[]> {
  const directory: string = join(genreRoot, 'character');
  let files: string[];

  try {
    files = (await readdir(directory)).filter((name) => name.endsWith('.card')).sort();
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const file of files) {
    const text: string = await readFile(join(directory, file), 'utf8');
    const match: RegExpExecArray | null = /^name:\s*(.+)$/mu.exec(text);
    if (match !== null) {
      names.push((match[1] as string).trim());
    }
  }

  return names;
}

async function readJudgeMaterials(
  genreRoot: string,
  genre: string,
  scenes: readonly TrackScene[],
): Promise<JudgeMaterials | string> {
  if (genre === axisGenre) {
    const floors: ReadonlyMap<string, string> = await readAxisFloors(genreRoot, scenes);
    if (floors.size !== scenes.length) {
      return `${join(genreRoot, 'floor')} 에 씬마다 훼손 원고가 있어야 합니다 (${floors.size}/${scenes.length}).`;
    }
    return {
      genre,
      characterNames: [],
      floorDraft: { sceneStem: '', text: '' },
      ledger: undefined,
      axisFloors: floors,
    };
  }

  let floorDraft: JudgeMaterials['floorDraft'] | undefined;

  for (const scene of scenes) {
    try {
      const text: string = await readFile(
        join(genreRoot, 'floor', `${scene.sceneStem}.md`),
        'utf8',
      );
      floorDraft = { sceneStem: scene.sceneStem, text };
      break;
    } catch {
      continue;
    }
  }

  if (floorDraft === undefined) {
    return `${join(genreRoot, 'floor')} 에 훼손 원고가 없습니다. 하한선 관문 없이는 심판을 믿을 수 없어 시작하지 않습니다.`;
  }

  const characterNames: readonly string[] = await readCharacterNames(genreRoot);

  let ledger: JudgeMaterials['ledger'];
  try {
    ledger = parseFactLedger(await readFile(join(genreRoot, 'facts.yaml'), 'utf8'));
  } catch {
    ledger = undefined;
  }

  return { genre, characterNames, floorDraft, ledger };
}

const axisGenre: string = 'axis';

function resolveGenreRoot(trackRoot: string, genre: string | undefined): string {
  if (genre === axisGenre) {
    return join(trackRoot, 'track', axisGenre);
  }
  return genre === undefined ? trackRoot : join(trackRoot, 'track', 'chain', genre);
}

interface OverlayPoint {
  readonly label: string;
  readonly knobs: Record<string, number>;
  readonly refusals: readonly string[];
}

async function loadOverlayPoint(
  overlayPath: string | undefined,
  provider: AiProviderId,
): Promise<OverlayPoint> {
  if (overlayPath === undefined) {
    return { label: 'point', knobs: {}, refusals: [] };
  }

  const overlay: Overlay = parseOverlay(JSON.parse(await readFile(overlayPath, 'utf8')));
  const { refusals } = applyOverlay(overlay, provider);

  return { label: overlay.label ?? 'point', knobs: overlay.knobs, refusals };
}

interface Selection {
  readonly providerId: AiProviderId;
  readonly model: string;
  readonly promptVariant?: PromptVariantId;
}

function generationRecord(
  selection: Selection,
  localRuntime: SimConfig['ollama'],
): RunRecord['generation'] {
  return {
    providerId: selection.providerId,
    model: selection.model,
    ...(selection.promptVariant === undefined ? {} : { promptVariant: selection.promptVariant }),
    ...(selection.providerId === 'ollama' && localRuntime?.think !== undefined
      ? { think: localRuntime.think }
      : {}),
  };
}

function generationSelection(context: CommandContext, config: SimConfig): Selection | string {
  const flagProvider: string | undefined = requireFlag(context, 'provider');
  const flagModel: string | undefined = requireFlag(context, 'model');
  const rawVariant: string | undefined =
    requireFlag(context, 'prompt-variant') ?? config.generation?.promptVariant;
  const variant: ZodSafeParseResult<PromptVariantId> | undefined =
    rawVariant === undefined ? undefined : promptVariantSchema.safeParse(rawVariant);

  if (variant !== undefined && !variant.success) {
    return `프롬프트 변형을 모릅니다: ${rawVariant}\n쓸 수 있는 값: ${promptVariantIds.join(', ')}`;
  }

  const withVariant = (selection: Omit<Selection, 'promptVariant'>): Selection => ({
    ...selection,
    ...(variant === undefined ? {} : { promptVariant: variant.data }),
  });

  if (flagProvider !== undefined) {
    if (!isAvailableProviderId(flagProvider)) {
      return `알 수 없는 프로바이더: ${flagProvider}\n쓸 수 있는 값: ${availableProviderIds().join(', ')}`;
    }
    const model: string = flagModel ?? storyboardModelCatalog[flagProvider][0]?.id;
    return model === undefined
      ? `${flagProvider} 에 쓸 모델을 --model 로 주세요.`
      : withVariant({ providerId: flagProvider, model });
  }

  if (config.generation !== undefined) {
    if (!isAvailableProviderId(config.generation.provider)) {
      return `${simConfigFileName} 의 generation.provider 를 모릅니다: ${config.generation.provider}`;
    }
    return withVariant({
      providerId: config.generation.provider,
      model: flagModel ?? config.generation.model,
    });
  }

  const providerId: AiProviderId = context.container.configBridge.getTaskProvider('sceneDraft');
  return withVariant({
    providerId,
    model: flagModel ?? context.container.configBridge.getTaskAiConfig('sceneDraft').model,
  });
}

const noJudge: string = 'none';

function judgeDisabled(context: CommandContext): boolean {
  return requireFlag(context, 'judge') === noJudge;
}

function judgeSelection(
  context: CommandContext,
  config: SimConfig,
  generation: Selection,
): Selection | string {
  const rawProvider: string | undefined = requireFlag(context, 'judge') ?? config.judge?.provider;

  if (rawProvider === undefined) {
    return `--judge 로 심판을 정하거나 ${simConfigFileName} 에 judge 를 적어 주세요. 생성과 같은 모델이면 자기 글을 자기가 채점하게 됩니다.`;
  }

  if (!isAvailableProviderId(rawProvider)) {
    return `알 수 없는 심판 프로바이더: ${rawProvider}\n쓸 수 있는 값: ${availableProviderIds().join(', ')}`;
  }

  const model: string =
    requireFlag(context, 'judge-model') ??
    (rawProvider === config.judge?.provider ? config.judge.model : undefined) ??
    storyboardModelCatalog[rawProvider][0]?.id;

  if (model === undefined) {
    return `${rawProvider} 에 쓸 심판 모델을 --judge-model 로 주세요.`;
  }

  if (rawProvider === generation.providerId && model === generation.model) {
    return `심판과 생성이 같은 모델(${rawProvider}:${model})입니다. 다른 모델을 골라 주세요.`;
  }

  return { providerId: rawProvider, model };
}

function repeatsOf(context: CommandContext, config: SimConfig): number {
  const flag: string | undefined = requireFlag(context, 'repeats');
  return flag === undefined ? (config.repeats ?? simDefaults.run.repeats) : Number(flag);
}

const unmeasuredBaselineUntilTheFirstRun: BaselineSample = {
  generationCallsPerScene: 7,
  inputTokensPerCall: 4000,
  outputTokensPerCall: 1500,
  secondsPerCall: 30,
  measuredAt: '미실측 (기본 추정)',
};

function reportEstimate(
  context: CommandContext,
  points: readonly DesignedPoint[],
  judgeCallsPerRun: number,
  generation: Selection,
  sceneCount: number,
  repeats: number,
): CommandOutcome | undefined {
  const maxRuns: string | undefined = requireFlag(context, 'max-runs');

  const estimate: BudgetEstimate = estimateBudget({
    points: points.length,
    repeats,
    sceneCount,
    judgeCallsPerRun,
    generationProvider: generation.providerId,
    generationModel: generation.model,
    baseline: unmeasuredBaselineUntilTheFirstRun,
  });

  if (!withinCap(estimate, maxRuns === undefined ? undefined : Number(maxRuns))) {
    return refuse(
      `실행 ${estimate.points * estimate.repeats}회는 --max-runs ${maxRuns} 를 넘습니다.`,
    );
  }

  if (flagBoolean(context.args.flags, 'yes')) {
    return undefined;
  }

  const cost: string =
    estimate.estimatedUsd === undefined ? '금액 불명' : `$${estimate.estimatedUsd.toFixed(2)}`;

  return {
    ok: true,
    message: [
      `지점 ${estimate.points} × ${estimate.repeats}회 = 실행 ${estimate.points * estimate.repeats}회`,
      `생성 호출 ${estimate.generationCalls.toLocaleString()} · 심판 호출 ${estimate.judgeCalls.toLocaleString()}`,
      `예상 비용 ${cost} · 예상 시간 ${estimate.estimatedWallClockHours.toFixed(1)}시간`,
      '',
      ...estimate.assumptions.map((line) => `  ${line}`),
      '',
      '이대로 돌리려면 --yes 를 붙이세요.',
    ].join('\n'),
    data: estimate,
  };
}

async function executePoints(
  context: CommandContext,
  input: {
    readonly points: readonly DesignedPoint[];
    readonly trackRoot: string;
    readonly genreRoot: string;
    readonly scenes: readonly TrackScene[];
    readonly generation: Selection;
    readonly outPath: string;
    readonly repeats: number;
    readonly localRuntime: SimConfig['ollama'];
    readonly judge?: Selection;
    readonly materials?: JudgeMaterials;
    readonly genre: string;
  },
): Promise<CommandOutcome> {
  const track: TrackRef = await describeTrack(input.trackRoot);

  if (track.dirty) {
    return refuse(
      '트랙에 커밋하지 않은 변경이 있습니다. 기록한 커밋이 실제 입력을 설명하지 못하므로 먼저 정리해 주세요.',
    );
  }

  const localRefusal: string | undefined = await refuseMissingLocalModels(input);
  if (localRefusal !== undefined) {
    return refuse(localRefusal);
  }

  const engineVersion: string = context.container.version;
  const engineCommit: string = await describeEngine(
    dirname(process.argv[1] ?? process.cwd()),
    engineVersion,
  );
  const { repeats } = input;
  const done: ReadonlySet<string> = await completedKeys(input.outPath, {
    engineCommit,
    trackCommit: track.commit,
    generation: generationRecord(input.generation, input.localRuntime),
    ...(input.judge === undefined
      ? {}
      : { judge: { providerId: input.judge.providerId, model: input.judge.model } }),
  });
  const factory: ISimWorkspaceFactory = createSimWorkspaceFactory({
    logger: context.container.logger,
    version: context.container.version,
    provider: input.generation.providerId,
    model: input.generation.model,
    ...(input.localRuntime === undefined ? {} : { localRuntime: input.localRuntime }),
    ...(input.generation.promptVariant === undefined
      ? {}
      : { promptVariant: input.generation.promptVariant }),
  });

  const judgeRegistry: AiProviderRegistry =
    input.localRuntime === undefined
      ? context.container.aiProviderRegistry
      : createCliContainer({
          workspacePath: context.container.workspaceRoot.fsPath,
          logger: context.container.logger,
          canPrompt: false,
          version: context.container.version,
          localRuntime: {
            ...(input.localRuntime.baseUrl === undefined
              ? {}
              : { baseUrl: input.localRuntime.baseUrl }),
            ...(input.localRuntime.contextTokens === undefined
              ? {}
              : { contextTokens: input.localRuntime.contextTokens }),
          },
        }).aiProviderRegistry;

  let ran: number = 0;
  let skipped: number = 0;

  for (const point of input.points) {
    for (let repeat: number = 1; repeat <= repeats; repeat += 1) {
      if (done.has(runKey(input.genre, point.label, repeat))) {
        skipped += 1;
        continue;
      }

      const { tuning, promptOverrides, sectionOutputLimit, refusals } = applyOverlay(
        { knobs: point.knobs },
        input.generation.providerId,
      );

      if (refusals.length > 0) {
        return refuse(refusals.join('\n'));
      }

      const scratch: string = await copyToScratch(input.genreRoot);

      try {
        const started: string = new Date().toISOString();
        const trackRun: TrackRunResult = await runTrack({
          factory,
          workspacePath: scratch,
          scenes: input.scenes,
          tuning,
          promptOverrides,
          ...(sectionOutputLimit === undefined ? {} : { sectionOutputLimit }),
          onProgress: (stem, current, total) =>
            context.container.logger.info(
              `${point.label} ${repeat}회 · ${current}/${total} ${stem}`,
            ),
        });

        const draftsDir: string = await keepDrafts(
          input.outPath,
          { genre: input.genre, pointLabel: point.label, repeat },
          trackRun.drafts,
        );

        let verdictFields: Partial<RunRecord> = {};

        try {
          if (input.judge !== undefined && input.materials?.axisFloors !== undefined) {
            const judge: SimJudge = createSimJudge({
              registry: judgeRegistry,
              judge: input.judge,
              generation: input.generation,
            });
            const axisFloors: ReadonlyMap<string, string> = input.materials.axisFloors;
            const verdicts: readonly AxisVerdict[] = await judgeAxis({
              judge,
              scenes: input.scenes.flatMap((scene) => {
                const draft: string | undefined = trackRun.drafts.get(scene.sceneStem);
                const floorDraft: string | undefined = axisFloors.get(scene.sceneStem);
                return draft === undefined
                  ? []
                  : [
                      {
                        sceneStem: scene.sceneStem,
                        axis: scene.title,
                        question: scene.purpose,
                        draft,
                        ...(floorDraft === undefined ? {} : { floorDraft }),
                      },
                    ];
              }),
            });
            verdictFields = { axisVerdicts: verdicts } as Partial<RunRecord>;
            for (const verdict of verdicts) {
              context.container.logger.info(
                `${verdict.sceneStem} · ${verdict.axis} · ${verdict.verdict}${verdict.discarded ? ` (폐기: ${verdict.discardReason ?? ''})` : ''}`,
              );
            }
          } else if (input.judge !== undefined && input.materials !== undefined) {
            verdictFields = await judgeChainDrafts(context, {
              judgeRegistry,
              judge: input.judge,
              generation: input.generation,
              materials: input.materials,
              scenes: input.scenes,
              drafts: trackRun.drafts,
              label: `${point.label} ${repeat}회`,
              draftsDir,
            });
          }
        } catch (error) {
          const message: string = extractErrorMessage(error);
          context.container.logger.warn(
            `${point.label} ${repeat}회 · 심판 실패, 생성 결과만 남깁니다: ${message}`,
          );
          verdictFields = { discarded: true, discardReasons: [`심판 실패: ${message}`] };
        }

        const record: RunRecord = {
          runId: runKey(input.genre, point.label, repeat),
          genre: input.genre,
          pointLabel: point.label,
          repeat,
          engineCommit,
          engineVersion,
          trackCommit: track.commit,
          trackDirty: false,
          knobs: point.knobs,
          generation: generationRecord(input.generation, input.localRuntime),
          ...(input.judge === undefined
            ? {}
            : { judge: { providerId: input.judge.providerId, model: input.judge.model } }),
          scenes: trackRun.metrics.scenes,
          tokens: trackRun.tokens,
          ...verdictFields,
          draftsDir,
          startedAt: started,
          wallClockMs: trackRun.wallClockMs,
        };

        await appendRun(input.outPath, record);
        ran += 1;
        context.container.logger.info(
          `${point.label} ${repeat}회 · 도달률 ${trackRun.metrics.meanReach.toFixed(3)} · ${describeCost(trackRun.tokens)}` +
            (record.auc === undefined ? '' : ` · AUC ${record.auc.toFixed(3)}`) +
            (record.recalled === undefined
              ? ''
              : ` · 회수 ${record.recalled}/${record.recallTotal}`),
        );
      } finally {
        await removeScratch(scratch);
      }
    }
  }

  return {
    ok: true,
    message: `실행 ${ran}회 완료${skipped > 0 ? ` (이미 끝난 ${skipped}회는 건너뜀)` : ''} → ${input.outPath}`,
    data: { ran, skipped, out: input.outPath, trackCommit: track.commit },
  };
}

async function refuseMissingLocalModels(input: {
  readonly generation: Selection;
  readonly judge?: Selection;
  readonly localRuntime: SimConfig['ollama'];
}): Promise<string | undefined> {
  const wanted: string[] = [input.generation, input.judge]
    .filter((selection): selection is Selection => selection?.providerId === 'ollama')
    .map((selection) => selection.model);

  if (wanted.length === 0) {
    return undefined;
  }

  const baseUrl: string = input.localRuntime?.baseUrl ?? 'http://127.0.0.1:11434';
  let available: readonly string[];

  try {
    available = await listLocalModels(baseUrl);
  } catch (error) {
    return `ollama 에 닿지 못했습니다 (${baseUrl}): ${extractErrorMessage(error)}`;
  }

  const missing: readonly string[] = missingLocalModels(available, wanted);

  return missing.length === 0
    ? undefined
    : `ollama 에 없는 모델입니다: ${missing.join(', ')} (있는 것: ${available.join(', ') || '없음'}). ollama pull 로 받거나 sim.config 의 모델을 고치세요.`;
}

async function judgeChainDrafts(
  context: CommandContext,
  input: {
    readonly judgeRegistry: AiProviderRegistry;
    readonly judge: Selection;
    readonly generation: Selection;
    readonly materials: JudgeMaterials;
    readonly scenes: readonly TrackScene[];
    readonly drafts: ReadonlyMap<string, string>;
    readonly label: string;
    readonly draftsDir: string;
  },
): Promise<Partial<RunRecord>> {
  const judge: SimJudge = createSimJudge({
    registry: input.judgeRegistry,
    judge: input.judge,
    generation: input.generation,
  });
  const orderedDrafts: SceneDraft[] = input.scenes
    .map((scene) => ({ sceneStem: scene.sceneStem, draft: input.drafts.get(scene.sceneStem) }))
    .filter((scene): scene is SceneDraft => scene.draft !== undefined);
  const generatedForFloor: string | undefined = input.drafts.get(
    input.materials.floorDraft.sceneStem,
  );

  const verdict: PanelVerdict = await judgeChain({
    judge,
    scenes: orderedDrafts,
    genre: input.materials.genre,
    floorCandidates: [
      { kind: 'generated', draft: generatedForFloor ?? '' },
      { kind: 'floor', draft: input.materials.floorDraft.text },
    ],
    critic: { names: input.materials.characterNames },
  });

  let fields: Partial<RunRecord> = {
    auc: verdict.discarded ? undefined : verdict.auc.auc,
    discarded: verdict.discarded,
    ...(verdict.discarded ? { discardReasons: verdict.discardReasons } : {}),
    floorGate: verdict.floor,
    panel: {
      byReader: verdict.auc.byReader,
      curves: verdict.auc.curves,
      dropOffScene: verdict.auc.dropOffScene,
      engagement: verdict.auc.engagement,
      engagementByReader: verdict.auc.engagementByReader,
    },
    genreNotes: verdict.genreNotes,
    ...(verdict.genreProblems.length > 0 ? { genreProblems: verdict.genreProblems } : {}),
    ...(verdict.critic === undefined
      ? {}
      : {
          critic: {
            groundedTotal: verdict.critic.groundedTotal,
            opinionTotal: verdict.critic.opinionTotal,
            gatePassed: verdict.critic.gate.passed,
            scores: verdict.critic.scores,
            gateReason: verdict.critic.gate.reason,
            problems: verdict.critic.problems,
          },
        }),
  };

  if (verdict.critic !== undefined && !verdict.critic.gate.passed) {
    context.container.logger.warn(
      `${input.label} · 비평 관문 실패 (회차는 유지): ${verdict.critic.gate.reason}`,
    );
  }

  if (input.materials.ledger !== undefined && !verdict.discarded) {
    const recall: FactRecallReport = await scoreFactRecall({
      ledger: input.materials.ledger,
      draftsByScene: input.drafts,
      judge: createFactRecallJudge(judge),
    });
    fields = {
      ...fields,
      recalled: recall.recalled,
      recallTotal: recall.total,
      contradicted: recall.contradicted,
    };
  }

  if (verdict.discarded) {
    context.container.logger.warn(
      `${input.label} · 심판 회차 폐기: ${verdict.discardReasons.join(' / ')} · 원고: ${input.draftsDir}`,
    );
  }

  if (!verdict.floor.passed) {
    context.container.logger.warn(
      `${input.label} · 하한선 관문 실패 (회차는 유지): ${[...verdict.floor.failures, ...verdict.floor.abstained].join(' / ')}`,
    );
  }

  if (verdict.genreProblems.length > 0) {
    context.container.logger.warn(
      `${input.label} · 장르 독자 중단 (회차는 유지): ${verdict.genreProblems.join(' / ')}`,
    );
  }

  return { ...fields, judgeTokens: judgeUsageTotals(judge) };
}

function judgeUsageTotals(judge: SimJudge): TokenTotals {
  return summarizeUsage(
    judge.usage().map((response) => ({
      taskName: 'draftCritique' as const,
      providerId: response.providerId,
      model: response.model,
      ...(response.usage === undefined ? {} : { usage: response.usage }),
      ...(response.costUsd === undefined ? {} : { costUsd: response.costUsd }),
      attribution: { primary: { kind: 'scene', id: 'sim-judge' } },
    })),
  );
}

interface SceneDraft {
  readonly sceneStem: string;
  readonly draft: string;
}

interface PreparedSim {
  readonly trackRoot: string;
  readonly genreRoot: string;
  readonly scenes: readonly TrackScene[];
  readonly generation: Selection;
  readonly outPath: string;
  readonly config: SimConfig;
  readonly repeats: number;
  readonly localRuntime: SimConfig['ollama'];
  readonly genre: string;
}

async function prepare(context: CommandContext): Promise<string | PreparedSim> {
  const trackRoot: string | undefined = requireFlag(context, 'track');

  if (trackRoot === undefined) {
    return '--track 으로 트랙 저장소를 지정해 주세요.';
  }

  const config: SimConfig = await readSimConfig(
    requireFlag(context, 'config') ?? join(trackRoot, simConfigFileName),
  );
  const genreRoot: string = resolveGenreRoot(trackRoot, requireFlag(context, 'genre'));
  const scenes: readonly TrackScene[] = await readTrackScenes(genreRoot);
  const generation: string | Selection = generationSelection(context, config);

  if (typeof generation === 'string') {
    return generation;
  }

  return {
    trackRoot,
    genreRoot,
    scenes,
    generation,
    outPath: requireFlag(context, 'out') ?? join(trackRoot, simResultsDirectory, 'runs.jsonl'),
    config,
    repeats: repeatsOf(context, config),
    localRuntime: config.ollama,
    genre: requireFlag(context, 'genre') ?? 'track',
  };
}

export const runSim: CommandHandler = async (context) => {
  const prepared: string | PreparedSim = await prepare(context);
  if (typeof prepared === 'string') {
    return refuse(prepared);
  }

  const overlay: OverlayPoint = await loadOverlayPoint(
    requireFlag(context, 'overlay'),
    prepared.generation.providerId,
  );
  if (overlay.refusals.length > 0) {
    return refuse(overlay.refusals.join('\n'));
  }

  const points: readonly DesignedPoint[] = [{ label: overlay.label, knobs: overlay.knobs }];
  const wantsJudge: boolean =
    !judgeDisabled(context) &&
    (requireFlag(context, 'judge') !== undefined || prepared.config.judge !== undefined);
  let judge: Selection | undefined;
  let materials: JudgeMaterials | undefined;
  let judgeCallsPerRun: number = 0;

  if (wantsJudge) {
    const selected: string | Selection = judgeSelection(
      context,
      prepared.config,
      prepared.generation,
    );
    if (typeof selected === 'string') {
      return refuse(selected);
    }
    const loaded: string | JudgeMaterials = await readJudgeMaterials(
      prepared.genreRoot,
      requireFlag(context, 'genre') ?? 'unknown',
      prepared.scenes,
    );
    if (typeof loaded === 'string') {
      return refuse(loaded);
    }
    judge = selected;
    materials = loaded;
    judgeCallsPerRun = simDefaults.panel.commonReaderCount * (prepared.scenes.length + 1);
  }

  const estimate: CommandOutcome | undefined = reportEstimate(
    context,
    points,
    judgeCallsPerRun,
    prepared.generation,
    prepared.scenes.length,
    prepared.repeats,
  );
  if (estimate !== undefined) {
    return estimate;
  }

  return await executePoints(context, {
    ...prepared,
    points,
    ...(judge === undefined ? {} : { judge }),
    ...(materials === undefined ? {} : { materials }),
  });
};

export const screenSim: CommandHandler = async (context) => {
  const prepared: string | PreparedSim = await prepare(context);
  if (typeof prepared === 'string') {
    return refuse(prepared);
  }

  const names: string[] | undefined = requireFlag(context, 'knobs')
    ?.split(',')
    .map((name) => name.trim());
  const selected: readonly KnobSpec[] | (KnobSpec | undefined)[] =
    names === undefined ? knobRegistry : names.map(findKnob);

  if (selected.some((knob) => knob === undefined)) {
    return refuse(`모르는 손잡이가 있습니다: ${names?.join(', ')}`);
  }

  const points: readonly DesignedPoint[] = planScreening(selected as typeof knobRegistry);
  const estimate: CommandOutcome | undefined = reportEstimate(
    context,
    points,
    0,
    prepared.generation,
    prepared.scenes.length,
    prepared.repeats,
  );
  if (estimate !== undefined) {
    return estimate;
  }

  return await executePoints(context, { ...prepared, points });
};

export const sweepSim: CommandHandler = async (context) => {
  const prepared: string | PreparedSim = await prepare(context);
  if (typeof prepared === 'string') {
    return refuse(prepared);
  }

  const names: string[] | undefined = requireFlag(context, 'knobs')
    ?.split(',')
    .map((name) => name.trim());

  if (names === undefined || names.length !== 4) {
    return refuse('--knobs 로 손잡이 넷을 정해 주세요. L9 격자는 넷을 요구합니다.');
  }

  const selected: (KnobSpec | undefined)[] = names.map(findKnob);
  if (selected.some((knob) => knob === undefined)) {
    return refuse(`모르는 손잡이가 있습니다: ${names.join(', ')}`);
  }

  const knobs: readonly KnobSpec[] = selected as typeof knobRegistry;
  const levels: Map<string, readonly number[]> = new Map(
    knobs.map((knob) => [knob.id, defaultGridLevels(knob)]),
  );
  const points: readonly DesignedPoint[] = planFractionalGrid(knobs, levels);

  if (judgeDisabled(context)) {
    return refuse(
      'sim sweep 은 심판 없이 돌지 않습니다. 격자의 품질 축이 비기 때문입니다. --judge none 은 sim run 에서만 씁니다.',
    );
  }

  const judge: string | Selection = judgeSelection(context, prepared.config, prepared.generation);
  if (typeof judge === 'string') {
    return refuse(judge);
  }

  const materials: string | JudgeMaterials = await readJudgeMaterials(
    prepared.genreRoot,
    requireFlag(context, 'genre') ?? 'unknown',
    prepared.scenes,
  );
  if (typeof materials === 'string') {
    return refuse(materials);
  }

  const judgeCallsPerRun: number =
    simDefaults.panel.commonReaderCount * (prepared.scenes.length + 1);
  const estimate: CommandOutcome | undefined = reportEstimate(
    context,
    points,
    judgeCallsPerRun,
    prepared.generation,
    prepared.scenes.length,
    prepared.repeats,
  );
  if (estimate !== undefined) {
    return estimate;
  }

  return await executePoints(context, { ...prepared, points, judge, materials });
};

function regressionLines(runs: readonly RunRecord[]): readonly string[] {
  const rows: readonly RegressionRow[] = regressionRows(runs);

  return rows.length === 0
    ? []
    : ['', '[회귀: 앞 엔진 대비]', ...rows.map((row) => `  ${describeRegression(row)}`)];
}

function scoreKey(point: PointScore): string {
  return [point.genre, point.pointLabel, point.engineCommit, point.trackCommit].join('\u0000');
}

export const reportSim: CommandHandler = async (context) => {
  const outPath: string | undefined = requireFlag(context, 'out');

  if (outPath === undefined) {
    return refuse('--out 으로 결과 파일을 지정해 주세요.');
  }

  const runs: readonly RunRecord[] = await readRuns(outPath);

  if (runs.length === 0) {
    return { ok: true, message: '아직 기록된 실행이 없습니다.', data: { runs: [] } };
  }

  const totalUsd: number | undefined = runs.reduce<number | undefined>(
    (total, run) =>
      total === undefined || run.tokens.costUsd === undefined
        ? undefined
        : total + run.tokens.costUsd,
    0,
  );
  const axis: CostAxis = chooseCostAxis(totalUsd);
  const scored: readonly PointScore[] = scoreRuns(runs, axis);
  const frontier: readonly ScoredPoint[] = paretoFrontier(
    scored.filter((point) => point.judged > 0),
  );
  const frontierKeys: Set<string> = new Set(frontier.map((point) => scoreKey(point as PointScore)));
  const judgedRuns: number = scored.reduce((total, point) => total + point.judged, 0);

  const fingerprints: Set<string> = new Set(
    scored.map((point) => `${point.engineCommit}@${point.trackCommit}`),
  );
  const mixed: boolean = fingerprints.size > 1;
  const generations: Set<string> = new Set(scored.map((point) => point.generation));
  const mixedGeneration: boolean = generations.size > 1;
  const judges: Set<string> = new Set(scored.map((point) => point.judge));
  const mixedJudge: boolean = judges.size > 1;

  const genres: string[] = [...new Set(scored.map((point) => point.genre))].sort();
  const lines: string[] = genres.flatMap((genre) => [
    '',
    `[${genre}]`,
    ...scored
      .filter((point) => point.genre === genre)
      .map((point) => {
        const mark: ' ' | '*' = frontierKeys.has(scoreKey(point)) ? '*' : ' ';
        const cost: string =
          axis === 'usd' ? `$${point.cost.toFixed(4)}` : point.cost.toLocaleString();
        const name: string =
          (mixed
            ? `${point.pointLabel} @${point.engineCommit.slice(0, 7)}/${point.trackCommit.slice(0, 7)}`
            : point.pointLabel) +
          (mixedGeneration ? ` [${point.generation}]` : '') +
          (mixedJudge && point.judge.length > 0 ? ` 심판:${point.judge}` : '');
        const engagement: string =
          point.engagement === undefined ? '' : ` 몰입 ${point.engagement.toFixed(2)}`;
        const quality: string =
          point.judged === 0
            ? `AUC n/a\t${cost}\t회수 n/a`
            : `AUC ${point.auc.toFixed(3)}${engagement}\t${cost}\t회수 ${point.recalled}`;
        const critic: string =
          point.critic === undefined
            ? ''
            : `\t비평 ${point.critic.grounded}/20 의견 ${point.critic.opinion}/10 비평관문 ${point.critic.gatePassed}/${point.critic.runs}`;
        const judgeCost: string =
          point.judgeCostUsd === undefined || point.judgeCostUsd === 0
            ? ''
            : `\t심판 $${point.judgeCostUsd.toFixed(2)}`;
        return `${mark} ${name}\t${quality}\t유효 ${point.judged}/${point.runs}\t관문 ${point.gatePassed}/${point.judged}${critic}${judgeCost}`;
      }),
  ]);

  return {
    ok: true,
    message: [
      `실행 ${runs.length}회 (유효 ${judgedRuns}회) · 지점 ${scored.length}개 · 시험체 ${genres.length}개 (* 는 그 시험체의 파레토 경계)`,
      `비용 축: ${costAxisLabels[axis]}`,
      '품질 축은 유효 회차의 중앙값, 비용 축은 전체 회차의 중앙값 · 관문은 유효 회차 중 심판이 훼손본을 가려낸 수',
      ...(mixed ? ['엔진·트랙이 다른 기록은 따로 셉니다 (@엔진/트랙)'] : []),
      ...(mixedGeneration
        ? ['생성 모델·프롬프트 변형이 다른 기록은 따로 셉니다 ([프로바이더:모델/변형])']
        : []),
      'ceiling: n/a',
      ...lines,
      ...regressionLines(runs),
    ].join('\n'),
    data: { runs: runs.length, costAxis: axis, points: scored, frontier },
  };
};

export const rejudgeSim: CommandHandler = async (context) => {
  const prepared: string | PreparedSim = await prepare(context);
  if (typeof prepared === 'string') {
    return refuse(prepared);
  }

  const point: string = requireFlag(context, 'point') ?? 'point';
  const selected: string | Selection = judgeSelection(
    context,
    prepared.config,
    prepared.generation,
  );
  if (typeof selected === 'string') {
    return refuse(selected);
  }

  const materials: string | JudgeMaterials = await readJudgeMaterials(
    prepared.genreRoot,
    prepared.genre,
    prepared.scenes,
  );
  if (typeof materials === 'string') {
    return refuse(materials);
  }
  if (materials.axisFloors !== undefined) {
    return refuse('축 트랙은 다시 채점하지 않습니다. 연쇄 트랙의 장르를 주세요.');
  }

  const runs: readonly RunRecord[] = await readRuns(prepared.outPath);
  const judge: Selection = { providerId: selected.providerId, model: selected.model };
  const engineVersion: string = context.container.version;
  const engineCommit: string = await describeEngine(
    dirname(process.argv[1] ?? process.cwd()),
    engineVersion,
  );
  const sources: readonly RejudgeSource[] = rejudgeSources(runs, {
    pointLabel: point,
    engineCommit,
    ...(requireFlag(context, 'source') === undefined
      ? {}
      : { enginePrefix: requireFlag(context, 'source') }),
    judge,
  });

  if (sources.length === 0) {
    return refuse(
      `${point} 에 다시 채점할 기록이 없습니다 (원고 자리가 있고 이 심판으로 아직 안 본 것).`,
    );
  }

  const localRefusal: string | undefined = await refuseMissingLocalModels({
    generation: selected,
    localRuntime: prepared.localRuntime,
  });
  if (localRefusal !== undefined) {
    return refuse(localRefusal);
  }

  const judgeCalls: number =
    sources.length * (simDefaults.panel.commonReaderCount + 1) * (prepared.scenes.length + 2);
  const plan: string[] = [
    `${point} 의 ${sources.length}회를 ${judge.providerId}:${judge.model} 으로 다시 채점합니다.`,
    ...sources.map(
      (source) =>
        `  ${source.run.runId} (${source.run.engineCommit.slice(0, 7)}, 원고 ${source.draftsDir})`,
    ),
    `심판 호출 약 ${judgeCalls.toLocaleString()}회. 생성은 하지 않습니다.`,
  ];

  if (!flagBoolean(context.args.flags, 'yes')) {
    return {
      ok: true,
      message: [...plan, '이대로 돌리려면 --yes 를 붙이세요.'].join('\n'),
      data: { point, sources: sources.length },
    };
  }

  const judgeRegistry: AiProviderRegistry =
    prepared.localRuntime === undefined
      ? context.container.aiProviderRegistry
      : createCliContainer({
          workspacePath: context.container.workspaceRoot.fsPath,
          logger: context.container.logger,
          canPrompt: false,
          version: context.container.version,
          localRuntime: {
            ...(prepared.localRuntime.baseUrl === undefined
              ? {}
              : { baseUrl: prepared.localRuntime.baseUrl }),
            ...(prepared.localRuntime.contextTokens === undefined
              ? {}
              : { contextTokens: prepared.localRuntime.contextTokens }),
          },
        }).aiProviderRegistry;

  let done: number = 0;
  for (const source of sources) {
    const drafts: Map<string, string> = await readKeptDrafts(
      join(dirname(prepared.outPath), source.draftsDir),
      prepared.scenes,
    );
    if (drafts.size === 0) {
      context.container.logger.warn(
        `${source.run.runId} · 원고를 찾지 못했습니다: ${source.draftsDir}`,
      );
      continue;
    }

    const generation: Selection = {
      providerId: source.run.generation.providerId as AiProviderId,
      model: source.run.generation.model,
    };
    let verdict: Partial<RunRecord>;
    try {
      verdict = await judgeChainDrafts(context, {
        judgeRegistry,
        judge: selected,
        generation,
        materials,
        scenes: prepared.scenes,
        drafts,
        label: `${source.run.runId} 재채점`,
        draftsDir: source.draftsDir,
      });
    } catch (error) {
      const message: string = extractErrorMessage(error);
      context.container.logger.warn(`${source.run.runId} · 심판 실패: ${message}`);
      verdict = { discarded: true, discardReasons: [`심판 실패: ${message}`] };
    }

    const record: RunRecord = rejudgedRecord(source.run, {
      engineCommit,
      engineVersion,
      judge,
      verdict,
      startedAt: new Date().toISOString(),
    });
    await appendRun(prepared.outPath, record);
    done += 1;
    context.container.logger.info(
      `${record.runId}` +
        (record.auc === undefined ? ' · 폐기' : ` · AUC ${record.auc.toFixed(3)}`) +
        (record.recalled === undefined ? '' : ` · 회수 ${record.recalled}/${record.recallTotal}`) +
        (record.judgeTokens?.costUsd === undefined
          ? ''
          : ` · 심판 $${record.judgeTokens.costUsd.toFixed(2)}`),
    );
  }

  return {
    ok: true,
    message: `다시 채점 ${done}회 완료 → ${prepared.outPath}`,
    data: { point, done, out: prepared.outPath },
  };
};

async function readKeptDrafts(
  directory: string,
  scenes: readonly TrackScene[],
): Promise<Map<string, string>> {
  const drafts: Map<string, string> = new Map<string, string>();
  for (const scene of scenes) {
    try {
      drafts.set(scene.sceneStem, await readFile(join(directory, `${scene.sceneStem}.md`), 'utf8'));
    } catch {
      continue;
    }
  }
  return drafts;
}

export const applySim: CommandHandler = async (context) => {
  const outPath: string | undefined = requireFlag(context, 'out');
  const point: string | undefined = requireFlag(context, 'point');

  if (outPath === undefined || point === undefined) {
    return refuse('--out 과 --point 를 모두 지정해 주세요.');
  }

  const runs: RunRecord[] = (await readRuns(outPath)).filter((run) => run.pointLabel === point);
  const judged: RunRecord[] = runs.filter(isJudged);

  if (runs.length === 0) {
    return refuse(`${point} 의 실행 기록이 없습니다.`);
  }

  if (judged.length < simDefaults.run.repeats) {
    return refuse(
      `${point} 은 유효 회차가 ${judged.length}회뿐입니다 (${runs.length}회 실행). 씨앗이 없어 회차마다 흔들리므로 ${simDefaults.run.repeats}회 이상의 중앙값이 필요합니다.`,
    );
  }

  const knobs: Readonly<Record<string, number>> = runs[0]?.knobs ?? {};
  const wrongTarget: string[] = Object.keys(knobs).filter(
    (id) => findKnob(id)?.applyTarget !== 'modelProfile',
  );

  if (wrongTarget.length > 0) {
    return refuse(
      [
        '모델 프로필에 적을 수 없는 손잡이가 있습니다:',
        ...wrongTarget.map((id) => `  ${id} → ${findKnob(id)?.applyTarget ?? '알 수 없음'}`),
        '한 모델에서만 잰 값은 공유 기본값이 아니라 모델 프로필에 들어갑니다.',
      ].join('\n'),
    );
  }

  const { fields, unsupported } = profileFieldsFor(knobs);

  if (unsupported.length > 0) {
    return refuse(`프로필 칸으로 옮길 수 없는 손잡이가 있습니다: ${unsupported.join(', ')}`);
  }

  const generation: RunRecord['generation'] = runs[0]?.generation as RunRecord['generation'];
  const key: string = `${generation.providerId}:${generation.model}`;
  const judge: RunRecord['judge'] = judged[0]?.judge;
  const measured: ProfileMeasurement = measurementFor(judged, {
    date: new Date().toISOString().slice(0, 10),
    ...(judge === undefined ? {} : { judge: `${judge.providerId}:${judge.model}` }),
  });
  const plan: string[] = [
    `${point} 를 ${key} 프로필에 적습니다.`,
    ...Object.entries(fields).map(([id, value]) => `  ${id} = ${JSON.stringify(value)}`),
    `  measured = ${JSON.stringify(measured)}`,
  ];

  if (flagBoolean(context.args.flags, 'dry-run')) {
    return {
      ok: true,
      message: ['적지 않고 계획만 보여 줍니다.', ...plan].join('\n'),
      data: { point, key, fields, measured, runs: runs.length, judged: judged.length },
    };
  }

  const profilesPath: string | undefined =
    requireFlag(context, 'profiles') ?? (await findModelProfilesFile());

  if (profilesPath === undefined) {
    return refuse(
      '엔진의 modelProfiles.params.json 을 찾지 못했습니다. 저장소 안에서 돌리거나 --profiles 로 경로를 주세요.',
    );
  }

  const profileWrite: ProfileWriteResult = await writeModelProfile(
    profilesPath,
    key,
    fields,
    measured,
    {
      force: flagBoolean(context.args.flags, 'force'),
    },
  );

  if (!profileWrite.written) {
    return refuse(
      [
        `${key} 프로필이 이미 있습니다. 덮어쓰려면 --force 를 붙이세요.`,
        `  지금 값: ${JSON.stringify(profileWrite.previous)}`,
      ].join('\n'),
    );
  }

  return {
    ok: true,
    message: [
      ...plan,
      `적었습니다: ${profilesPath}`,
      '검토 후 커밋하세요. 이 파일은 엔진 소스입니다.',
    ].join('\n'),
    data: {
      point,
      key,
      fields,
      measured,
      file: profilesPath,
      runs: runs.length,
      judged: judged.length,
    },
  };
};

async function findModelProfilesFile(): Promise<string | undefined> {
  let directory: string = dirname(process.argv[1] ?? process.cwd());

  for (let depth: number = 0; depth < 6; depth += 1) {
    const candidate: string = join(
      directory,
      'packages',
      'story-ai',
      'src',
      'contracts',
      'modelProfiles.params.json',
    );
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {
      directory = dirname(directory);
    }
  }

  return undefined;
}
