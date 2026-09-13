import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { aiProviderIds, storyboardModelCatalog } from '@storyboard/story-ai';
import type { AiProviderId } from '@storyboard/story-ai';
import { parseSceneCard, parseSceneFileName } from '@storyboard/story-format';
import {
  appendRun,
  applyOverlay,
  completedKeys,
  copyToScratch,
  createFactRecallJudge,
  createSimJudge,
  judgeAxis,
  judgeChain,
  parseFactLedger,
  scoreFactRecall,
  defaultGridLevels,
  describeCost,
  describeTrack,
  estimateBudget,
  findKnob,
  knobRegistry,
  median,
  chooseCostAxis,
  costAxisLabels,
  paretoFrontier,
  planFractionalGrid,
  planScreening,
  parseOverlay,
  readRuns,
  removeScratch,
  runKey,
  runTrack,
  readSimConfig,
  simConfigFileName,
  simDefaults,
  simResultsDirectory,
  withinCap,
  type DesignedPoint,
  type RunRecord,
  type ScoredPoint,
  type SimConfig,
} from '@storyboard/story-sim';

import { flagBoolean, flagString } from '@/cliArguments';
import { createSimWorkspaceFactory } from '@/adapters/simWorkspaceFactory';
import { createCliContainer } from '@/container';
import type { CommandContext, CommandHandler, CommandOutcome } from './outcome';

// NOTE: 시뮬레이터는 트랙 저장소를 대상으로 돌고 제품 워크스페이스를 요구하지 않는다. 그래서
// 다섯 동사 모두 needsWorkspace: false 이고, 대상은 --track 이 가리킨다.

interface TrackScene {
  readonly sceneStem: string;
  readonly targetLength: number;
  readonly title: string;
  readonly purpose: string;
}

interface JudgeMaterials {
  readonly genre: string;
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

// 씬 목록과 목표 분량은 카드가 갖는다. 따로 적은 목록은 카드와 어긋나는 순간 다른 것을 잰다.
async function readTrackScenes(genreRoot: string): Promise<readonly TrackScene[]> {
  const sceneDirectory = join(genreRoot, 'scene');
  const names = (await readdir(sceneDirectory)).filter((name) => parseSceneFileName(name));
  const scenes: TrackScene[] = [];

  for (const name of names.sort()) {
    const parts = parseSceneFileName(name);
    const card = parseSceneCard(await readFile(join(sceneDirectory, name), 'utf8'));

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

// 심판이 쓸 재료. 훼손 원고는 관문에 반드시 필요하므로 없으면 돈을 쓰기 전에 거부한다.
async function readAxisFloors(
  genreRoot: string,
  scenes: readonly TrackScene[],
): Promise<ReadonlyMap<string, string>> {
  const floors = new Map<string, string>();
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

async function readJudgeMaterials(
  genreRoot: string,
  genre: string,
  scenes: readonly TrackScene[],
): Promise<JudgeMaterials | string> {
  if (genre === axisGenre) {
    const floors = await readAxisFloors(genreRoot, scenes);
    if (floors.size !== scenes.length) {
      return `${join(genreRoot, 'floor')} 에 씬마다 훼손 원고가 있어야 합니다 (${floors.size}/${scenes.length}).`;
    }
    return {
      genre,
      floorDraft: { sceneStem: '', text: '' },
      ledger: undefined,
      axisFloors: floors,
    };
  }

  let floorDraft: JudgeMaterials['floorDraft'] | undefined;

  for (const scene of scenes) {
    try {
      const text = await readFile(join(genreRoot, 'floor', `${scene.sceneStem}.md`), 'utf8');
      floorDraft = { sceneStem: scene.sceneStem, text };
      break;
    } catch {
      continue;
    }
  }

  if (floorDraft === undefined) {
    return `${join(genreRoot, 'floor')} 에 훼손 원고가 없습니다. 하한선 관문 없이는 심판을 믿을 수 없어 시작하지 않습니다.`;
  }

  let ledger: JudgeMaterials['ledger'];
  try {
    ledger = parseFactLedger(await readFile(join(genreRoot, 'facts.yaml'), 'utf8'));
  } catch {
    ledger = undefined;
  }

  return { genre, floorDraft, ledger };
}

// 축 트랙은 장르가 아니라 진단표라 chain/ 아래가 아니다. 결과도 성능으로 보고하지 않는다.
const axisGenre = 'axis';

function resolveGenreRoot(trackRoot: string, genre: string | undefined): string {
  if (genre === axisGenre) {
    return join(trackRoot, 'track', axisGenre);
  }
  return genre === undefined ? trackRoot : join(trackRoot, 'track', 'chain', genre);
}

async function loadOverlayPoint(
  overlayPath: string | undefined,
  provider: AiProviderId,
): Promise<{ readonly knobs: Record<string, number>; readonly refusals: readonly string[] }> {
  if (overlayPath === undefined) {
    return { knobs: {}, refusals: [] };
  }

  const overlay = parseOverlay(JSON.parse(await readFile(overlayPath, 'utf8')));
  const { refusals } = applyOverlay(overlay, provider);

  return { knobs: overlay.knobs, refusals };
}

interface Selection {
  readonly providerId: AiProviderId;
  readonly model: string;
}

function isProviderId(value: string): value is AiProviderId {
  return aiProviderIds.includes(value as AiProviderId);
}

// 명령줄 > 트랙 저장소의 sim.config.json > 워크스페이스 자체 설정. 기계 프로필은 파일에 두고,
// 한 번만 바꿔 볼 값은 플래그로 준다.
function generationSelection(context: CommandContext, config: SimConfig): Selection | string {
  const flagProvider = requireFlag(context, 'provider');
  const flagModel = requireFlag(context, 'model');

  if (flagProvider !== undefined) {
    if (!isProviderId(flagProvider)) {
      return `알 수 없는 프로바이더: ${flagProvider}\n쓸 수 있는 값: ${aiProviderIds.join(', ')}`;
    }
    const model = flagModel ?? storyboardModelCatalog[flagProvider][0]?.id;
    return model === undefined
      ? `${flagProvider} 에 쓸 모델을 --model 로 주세요.`
      : { providerId: flagProvider, model };
  }

  if (config.generation !== undefined) {
    if (!isProviderId(config.generation.provider)) {
      return `${simConfigFileName} 의 generation.provider 를 모릅니다: ${config.generation.provider}`;
    }
    return { providerId: config.generation.provider, model: flagModel ?? config.generation.model };
  }

  const providerId = context.container.configBridge.getTaskProvider('sceneDraft');
  return {
    providerId,
    model: flagModel ?? context.container.configBridge.getTaskAiConfig('sceneDraft').model,
  };
}

const noJudge = 'none';

function judgeDisabled(context: CommandContext): boolean {
  return requireFlag(context, 'judge') === noJudge;
}

function judgeSelection(
  context: CommandContext,
  config: SimConfig,
  generation: Selection,
): Selection | string {
  const rawProvider = requireFlag(context, 'judge') ?? config.judge?.provider;

  if (rawProvider === undefined) {
    return `--judge 로 심판을 정하거나 ${simConfigFileName} 에 judge 를 적어 주세요. 생성과 같은 모델이면 자기 글을 자기가 채점하게 됩니다.`;
  }

  if (!isProviderId(rawProvider)) {
    return `알 수 없는 심판 프로바이더: ${rawProvider}\n쓸 수 있는 값: ${aiProviderIds.join(', ')}`;
  }

  const model =
    requireFlag(context, 'judge-model') ??
    (rawProvider === config.judge?.provider ? config.judge.model : undefined) ??
    storyboardModelCatalog[rawProvider][0]?.id;

  if (model === undefined) {
    return `${rawProvider} 에 쓸 심판 모델을 --judge-model 로 주세요.`;
  }

  // 같은 것은 프로바이더가 아니라 가중치다. 한 런타임의 다른 두 모델은 자기채점이 아니다.
  if (rawProvider === generation.providerId && model === generation.model) {
    return `심판과 생성이 같은 모델(${rawProvider}:${model})입니다. 다른 모델을 골라 주세요.`;
  }

  return { providerId: rawProvider, model };
}

function repeatsOf(context: CommandContext, config: SimConfig): number {
  const flag = requireFlag(context, 'repeats');
  return flag === undefined ? (config.repeats ?? simDefaults.run.repeats) : Number(flag);
}

// 견적을 찍고 멈춘다. --yes 가 없으면 한 호출도 하지 않는다.
function reportEstimate(
  context: CommandContext,
  points: readonly DesignedPoint[],
  judgeCallsPerRun: number,
  generation: Selection,
  sceneCount: number,
  repeats: number,
): CommandOutcome | undefined {
  const maxRuns = requireFlag(context, 'max-runs');

  const estimate = estimateBudget({
    points: points.length,
    repeats,
    sceneCount,
    judgeCallsPerRun,
    generationProvider: generation.providerId,
    generationModel: generation.model,
    // NOTE: 실측 기준선이 아직 없다. 첫 실행이 이 값을 재고 나면 그 값으로 바꾼다.
    baseline: {
      generationCallsPerScene: 7,
      inputTokensPerCall: 4000,
      outputTokensPerCall: 1500,
      secondsPerCall: 30,
      measuredAt: '미실측 (기본 추정)',
    },
  });

  if (!withinCap(estimate, maxRuns === undefined ? undefined : Number(maxRuns))) {
    return refuse(
      `실행 ${estimate.points * estimate.repeats}회는 --max-runs ${maxRuns} 를 넘습니다.`,
    );
  }

  if (flagBoolean(context.args.flags, 'yes')) {
    return undefined;
  }

  const cost =
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
  const track = await describeTrack(input.trackRoot);

  if (track.dirty) {
    return refuse(
      '트랙에 커밋하지 않은 변경이 있습니다. 기록한 커밋이 실제 입력을 설명하지 못하므로 먼저 정리해 주세요.',
    );
  }

  const engineCommit = context.container.version;
  const { repeats } = input;
  const done = await completedKeys(input.outPath, { engineCommit, trackCommit: track.commit });
  const factory = createSimWorkspaceFactory({
    logger: context.container.logger,
    version: context.container.version,
    provider: input.generation.providerId,
    model: input.generation.model,
    ...(input.localRuntime === undefined ? {} : { localRuntime: input.localRuntime }),
  });

  // NOTE: 심판도 생성과 같은 로컬 런타임에서 돈다. 명령을 띄운 컨테이너는 sim.config.json 을 읽지
  // 않으므로 주소와 문맥 창이 빠진 채로 심판을 부른다. 주소가 다른 기계에서는 연결이 끊겨 시끄럽게
  // 죽지만, 주소가 같은 기계에서는 num_ctx 없이 조용히 판정한다 — 8화 누적이 모델 기본 문맥을
  // 넘기면 뒤 독자가 앞을 못 읽은 채 점수를 낸다. 조용히 틀리는 쪽이 위험하므로 심판 레지스트리도
  // 같은 프로필로 세운다.
  const judgeRegistry =
    input.localRuntime === undefined
      ? context.container.aiProviderRegistry
      : createCliContainer({
          workspacePath: context.container.workspaceRoot.fsPath,
          logger: context.container.logger,
          canPrompt: false,
          version: context.container.version,
          localRuntime: input.localRuntime,
        }).aiProviderRegistry;

  let ran = 0;
  let skipped = 0;

  for (const point of input.points) {
    for (let repeat = 1; repeat <= repeats; repeat += 1) {
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

      // 생성이 씬 카드를 되쓰므로 회차마다 사본에서 돈다.
      const scratch = await copyToScratch(input.genreRoot);

      try {
        const started = new Date().toISOString();
        const result = await runTrack({
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

        let verdictFields: Partial<RunRecord> = {};

        // 생성이 끝난 뒤에 심판을 부른다. 심판 사용량은 생성 원장에 섞이지 않는다.
        // NOTE: 심판이 죽어도 생성 결과는 남긴다. 이미 돈을 쓴 회차를 심판 탓에 잃으면 안 된다.
        try {
          if (input.judge !== undefined && input.materials?.axisFloors !== undefined) {
            const judge = createSimJudge({
              registry: judgeRegistry,
              judge: input.judge,
              generation: input.generation,
            });
            const axisFloors = input.materials.axisFloors;
            const verdicts = await judgeAxis({
              judge,
              scenes: input.scenes.flatMap((scene) => {
                const draft = result.drafts.get(scene.sceneStem);
                const floorDraft = axisFloors.get(scene.sceneStem);
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
            const judge = createSimJudge({
              registry: judgeRegistry,
              judge: input.judge,
              generation: input.generation,
            });
            const orderedDrafts = input.scenes
              .map((scene) => ({
                sceneStem: scene.sceneStem,
                draft: result.drafts.get(scene.sceneStem),
              }))
              .filter(
                (scene): scene is { sceneStem: string; draft: string } => scene.draft !== undefined,
              );
            const generatedForFloor = result.drafts.get(input.materials.floorDraft.sceneStem);

            const verdict = await judgeChain({
              judge,
              scenes: orderedDrafts,
              genre: input.materials.genre,
              floorCandidates: [
                { kind: 'generated', draft: generatedForFloor ?? '' },
                { kind: 'floor', draft: input.materials.floorDraft.text },
              ],
            });

            verdictFields = {
              auc: verdict.discarded ? undefined : verdict.auc.auc,
              discarded: verdict.discarded,
            };

            if (input.materials.ledger !== undefined && !verdict.discarded) {
              const recall = await scoreFactRecall({
                ledger: input.materials.ledger,
                draftsByScene: result.drafts,
                judge: createFactRecallJudge(judge),
              });
              verdictFields = {
                ...verdictFields,
                recalled: recall.recalled,
                recallTotal: recall.total,
                contradicted: recall.contradicted,
              };
            }

            if (verdict.discarded) {
              context.container.logger.warn(
                `${point.label} ${repeat}회 · 심판 회차 폐기: ${verdict.discardReasons.join(' / ')}`,
              );
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          context.container.logger.warn(
            `${point.label} ${repeat}회 · 심판 실패, 생성 결과만 남깁니다: ${message}`,
          );
          verdictFields = { discarded: true };
        }

        const record: RunRecord = {
          runId: runKey(input.genre, point.label, repeat),
          genre: input.genre,
          pointLabel: point.label,
          repeat,
          engineCommit,
          trackCommit: track.commit,
          trackDirty: false,
          knobs: point.knobs,
          generation: input.generation,
          scenes: result.metrics.scenes,
          tokens: result.tokens,
          ...verdictFields,
          startedAt: started,
          wallClockMs: result.wallClockMs,
        };

        await appendRun(input.outPath, record);
        ran += 1;
        context.container.logger.info(
          `${point.label} ${repeat}회 · 도달률 ${result.metrics.meanReach.toFixed(3)} · ${describeCost(result.tokens)}` +
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

async function prepare(context: CommandContext): Promise<
  | string
  | {
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
> {
  const trackRoot = requireFlag(context, 'track');

  if (trackRoot === undefined) {
    return '--track 으로 트랙 저장소를 지정해 주세요.';
  }

  const config = await readSimConfig(
    requireFlag(context, 'config') ?? join(trackRoot, simConfigFileName),
  );
  const genreRoot = resolveGenreRoot(trackRoot, requireFlag(context, 'genre'));
  const scenes = await readTrackScenes(genreRoot);
  const generation = generationSelection(context, config);

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
  const prepared = await prepare(context);
  if (typeof prepared === 'string') {
    return refuse(prepared);
  }

  const overlay = await loadOverlayPoint(
    requireFlag(context, 'overlay'),
    prepared.generation.providerId,
  );
  if (overlay.refusals.length > 0) {
    return refuse(overlay.refusals.join('\n'));
  }

  const points: readonly DesignedPoint[] = [{ label: 'point', knobs: overlay.knobs }];
  const wantsJudge =
    !judgeDisabled(context) &&
    (requireFlag(context, 'judge') !== undefined || prepared.config.judge !== undefined);
  let judge: Selection | undefined;
  let materials: JudgeMaterials | undefined;
  let judgeCallsPerRun = 0;

  if (wantsJudge) {
    const selected = judgeSelection(context, prepared.config, prepared.generation);
    if (typeof selected === 'string') {
      return refuse(selected);
    }
    const loaded = await readJudgeMaterials(
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

  const estimate = reportEstimate(
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
  const prepared = await prepare(context);
  if (typeof prepared === 'string') {
    return refuse(prepared);
  }

  const names = requireFlag(context, 'knobs')
    ?.split(',')
    .map((name) => name.trim());
  const selected = names === undefined ? knobRegistry : names.map(findKnob);

  if (selected.some((knob) => knob === undefined)) {
    return refuse(`모르는 손잡이가 있습니다: ${names?.join(', ')}`);
  }

  const points = planScreening(selected as typeof knobRegistry);
  const estimate = reportEstimate(
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
  const prepared = await prepare(context);
  if (typeof prepared === 'string') {
    return refuse(prepared);
  }

  const names = requireFlag(context, 'knobs')
    ?.split(',')
    .map((name) => name.trim());

  if (names === undefined || names.length !== 4) {
    return refuse('--knobs 로 손잡이 넷을 정해 주세요. L9 격자는 넷을 요구합니다.');
  }

  const selected = names.map(findKnob);
  if (selected.some((knob) => knob === undefined)) {
    return refuse(`모르는 손잡이가 있습니다: ${names.join(', ')}`);
  }

  const knobs = selected as typeof knobRegistry;
  const levels = new Map(knobs.map((knob) => [knob.id, defaultGridLevels(knob)]));
  const points = planFractionalGrid(knobs, levels);

  if (judgeDisabled(context)) {
    return refuse(
      'sim sweep 은 심판 없이 돌지 않습니다. 격자의 품질 축이 비기 때문입니다. --judge none 은 sim run 에서만 씁니다.',
    );
  }

  const judge = judgeSelection(context, prepared.config, prepared.generation);
  if (typeof judge === 'string') {
    return refuse(judge);
  }

  const materials = await readJudgeMaterials(
    prepared.genreRoot,
    requireFlag(context, 'genre') ?? 'unknown',
    prepared.scenes,
  );
  if (typeof materials === 'string') {
    return refuse(materials);
  }

  const judgeCallsPerRun = simDefaults.panel.commonReaderCount * (prepared.scenes.length + 1);
  const estimate = reportEstimate(
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

function scorePoints(
  runs: readonly RunRecord[],
  axis: ReturnType<typeof chooseCostAxis>,
): readonly ScoredPoint[] {
  const byLabel = new Map<string, RunRecord[]>();

  for (const run of runs) {
    const label = `${run.genre}/${run.pointLabel}`;
    byLabel.set(label, [...(byLabel.get(label) ?? []), run]);
  }

  const costOf = (run: RunRecord): number => {
    if (axis === 'usd') {
      return run.tokens.costUsd ?? 0;
    }
    return run.tokens.inputTokens + run.tokens.outputTokens;
  };

  return [...byLabel.entries()].map(([label, points]) => ({
    label,
    genre: (points[0] as RunRecord).genre,
    // 씨앗이 없어 회차마다 흔들리므로 최고값이 아니라 중앙값을 쓴다.
    auc: median(points.map((run) => run.auc ?? 0)),
    cost: median(points.map(costOf)),
    recalled: median(points.map((run) => run.recalled ?? 0)),
    contradicted: median(points.map((run) => run.contradicted ?? 0)),
  }));
}

export const reportSim: CommandHandler = async (context) => {
  const outPath = requireFlag(context, 'out');

  if (outPath === undefined) {
    return refuse('--out 으로 결과 파일을 지정해 주세요.');
  }

  const runs = await readRuns(outPath);

  if (runs.length === 0) {
    return { ok: true, message: '아직 기록된 실행이 없습니다.', data: { runs: [] } };
  }

  // 요금이 0인 모델로 돌았으면 금액으로는 지점을 가를 수 없다. 그때는 토큰이 x축이 된다.
  const totalUsd = runs.reduce<number | undefined>(
    (total, run) =>
      total === undefined || run.tokens.costUsd === undefined
        ? undefined
        : total + run.tokens.costUsd,
    0,
  );
  const axis = chooseCostAxis(totalUsd);
  const scored = scorePoints(runs, axis);
  const frontier = paretoFrontier(scored);
  const frontierLabels = new Set(frontier.map((point) => point.label));

  // 시험체마다 따로 줄을 세운다. 장르를 섞으면 «싼 장르» 가 «이긴 손잡이» 로 읽힌다.
  const genres = [...new Set(scored.map((point) => point.genre))].sort();
  const lines = genres.flatMap((genre) => [
    '',
    `[${genre}]`,
    ...scored
      .filter((point) => point.genre === genre)
      .map((point) => {
        const mark = frontierLabels.has(point.label) ? '*' : ' ';
        const cost = axis === 'usd' ? `$${point.cost.toFixed(4)}` : point.cost.toLocaleString();
        const name = point.label.slice(genre.length + 1);
        return `${mark} ${name}\tAUC ${point.auc.toFixed(3)}\t${cost}\t회수 ${point.recalled}`;
      }),
  ]);

  return {
    ok: true,
    message: [
      `실행 ${runs.length}회 · 지점 ${scored.length}개 · 시험체 ${genres.length}개 (* 는 그 시험체의 파레토 경계)`,
      `비용 축: ${costAxisLabels[axis]}`,
      // NOTE: 사람이 쓴 gt 가 아직 없어 상한선을 모른다. 점수를 «사람 글의 몇 퍼센트» 로 읽으면 안 된다.
      'ceiling: n/a',
      ...lines,
    ].join('\n'),
    data: { runs: runs.length, costAxis: axis, points: scored, frontier },
  };
};

export const applySim: CommandHandler = async (context) => {
  const outPath = requireFlag(context, 'out');
  const point = requireFlag(context, 'point');

  if (outPath === undefined || point === undefined) {
    return refuse('--out 과 --point 를 모두 지정해 주세요.');
  }

  const runs = (await readRuns(outPath)).filter((run) => run.pointLabel === point);

  if (runs.length === 0) {
    return refuse(`${point} 의 실행 기록이 없습니다.`);
  }

  if (runs.length < simDefaults.run.repeats) {
    return refuse(
      `${point} 은 ${runs.length}회만 돌았습니다. 씨앗이 없어 회차마다 흔들리므로 ${simDefaults.run.repeats}회 이상의 중앙값이 필요합니다.`,
    );
  }

  const knobs = runs[0]?.knobs ?? {};
  const wrongTarget = Object.keys(knobs).filter(
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

  return {
    ok: true,
    message: [
      flagBoolean(context.args.flags, 'dry-run') ? '적지 않고 계획만 보여 줍니다.' : '',
      `${point} 를 ${runs[0]?.generation.providerId}:${runs[0]?.generation.model} 프로필에 적습니다.`,
      ...Object.entries(knobs).map(([id, value]) => `  ${id} = ${value}`),
    ]
      .filter((line) => line.length > 0)
      .join('\n'),
    data: { point, knobs, runs: runs.length },
  };
};
