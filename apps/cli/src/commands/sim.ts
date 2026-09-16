import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

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
  type SimPromptVariant,
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
  // 비평가의 훼손본을 만들 때 뒤바꿀 인물 이름. 카드의 name 순서다.
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

// 훼손본은 인물 이름을 뒤바꿔 만든다. 카드의 name 한 줄이면 충분하다.
async function readCharacterNames(genreRoot: string): Promise<readonly string[]> {
  const directory = join(genreRoot, 'character');
  let files: string[];

  try {
    files = (await readdir(directory)).filter((name) => name.endsWith('.card')).sort();
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const file of files) {
    const text = await readFile(join(directory, file), 'utf8');
    const match = /^name:\s*(.+)$/mu.exec(text);
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
    const floors = await readAxisFloors(genreRoot, scenes);
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

  const characterNames = await readCharacterNames(genreRoot);

  let ledger: JudgeMaterials['ledger'];
  try {
    ledger = parseFactLedger(await readFile(join(genreRoot, 'facts.yaml'), 'utf8'));
  } catch {
    ledger = undefined;
  }

  return { genre, characterNames, floorDraft, ledger };
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
): Promise<{
  readonly label: string;
  readonly knobs: Record<string, number>;
  readonly refusals: readonly string[];
}> {
  if (overlayPath === undefined) {
    return { label: 'point', knobs: {}, refusals: [] };
  }

  const overlay = parseOverlay(JSON.parse(await readFile(overlayPath, 'utf8')));
  const { refusals } = applyOverlay(overlay, provider);

  return { label: overlay.label ?? 'point', knobs: overlay.knobs, refusals };
}

interface Selection {
  readonly providerId: AiProviderId;
  readonly model: string;
  readonly promptVariant?: SimPromptVariant;
}

// 기록에 남길 «무엇으로 썼는가». 프롬프트 변형과 생각 여부까지 적어야 같은 지점의 다른 실험을 가른다.
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

function isProviderId(value: string): value is AiProviderId {
  return aiProviderIds.includes(value as AiProviderId);
}

// 명령줄 > 트랙 저장소의 sim.config.json > 워크스페이스 자체 설정. 기계 프로필은 파일에 두고,
// 한 번만 바꿔 볼 값은 플래그로 준다.
function generationSelection(context: CommandContext, config: SimConfig): Selection | string {
  const flagProvider = requireFlag(context, 'provider');
  const flagModel = requireFlag(context, 'model');
  const rawVariant = requireFlag(context, 'prompt-variant') ?? config.generation?.promptVariant;
  const variant = rawVariant === undefined ? undefined : promptVariantSchema.safeParse(rawVariant);

  if (variant !== undefined && !variant.success) {
    return `프롬프트 변형을 모릅니다: ${rawVariant}\n쓸 수 있는 값: ${promptVariantSchema.options.join(', ')}`;
  }

  const withVariant = (selection: Omit<Selection, 'promptVariant'>): Selection => ({
    ...selection,
    ...(variant === undefined ? {} : { promptVariant: variant.data }),
  });

  if (flagProvider !== undefined) {
    if (!isProviderId(flagProvider)) {
      return `알 수 없는 프로바이더: ${flagProvider}\n쓸 수 있는 값: ${aiProviderIds.join(', ')}`;
    }
    const model = flagModel ?? storyboardModelCatalog[flagProvider][0]?.id;
    return model === undefined
      ? `${flagProvider} 에 쓸 모델을 --model 로 주세요.`
      : withVariant({ providerId: flagProvider, model });
  }

  if (config.generation !== undefined) {
    if (!isProviderId(config.generation.provider)) {
      return `${simConfigFileName} 의 generation.provider 를 모릅니다: ${config.generation.provider}`;
    }
    return withVariant({
      providerId: config.generation.provider,
      model: flagModel ?? config.generation.model,
    });
  }

  const providerId = context.container.configBridge.getTaskProvider('sceneDraft');
  return withVariant({
    providerId,
    model: flagModel ?? context.container.configBridge.getTaskAiConfig('sceneDraft').model,
  });
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

  const localRefusal = await refuseMissingLocalModels(input);
  if (localRefusal !== undefined) {
    return refuse(localRefusal);
  }

  // NOTE: 패키지 버전은 릴리스 사이의 엔진 빌드를 가르지 못한다. 하루에 다섯 빌드로 잰 기록이 전부
  // «0.9.3» 으로 남았다. 저장소 안에서 돌면 git 해시를, 아니면 버전을 적는다.
  const engineVersion = context.container.version;
  // 번들은 CommonJS 로 형검사되어 import.meta 를 못 쓴다. 실행 파일의 자리(dist/index.mjs)에서 찾는다.
  const engineCommit = await describeEngine(
    dirname(process.argv[1] ?? process.cwd()),
    engineVersion,
  );
  const { repeats } = input;
  const done = await completedKeys(input.outPath, {
    engineCommit,
    trackCommit: track.commit,
    generation: generationRecord(input.generation, input.localRuntime),
  });
  const factory = createSimWorkspaceFactory({
    logger: context.container.logger,
    version: context.container.version,
    provider: input.generation.providerId,
    model: input.generation.model,
    ...(input.localRuntime === undefined ? {} : { localRuntime: input.localRuntime }),
    ...(input.generation.promptVariant === undefined
      ? {}
      : { promptVariant: input.generation.promptVariant }),
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
          // 생각 켜기/끄기는 생성 쪽 실험 변수다. 심판 모델이 생각을 지원하지 않으면 ollama 가 거부한다.
          localRuntime: {
            ...(input.localRuntime.baseUrl === undefined ? {} : { baseUrl: input.localRuntime.baseUrl }),
            ...(input.localRuntime.contextTokens === undefined
              ? {}
              : { contextTokens: input.localRuntime.contextTokens }),
          },
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

        // 사본은 회차가 끝나면 지워진다. 심판이 회차를 버려도 무엇을 읽고 버렸는지 되짚을 수 있도록
        // 심판을 부르기 전에 원고부터 결과 곁에 남긴다.
        const draftsDir = await keepDrafts(
          input.outPath,
          { genre: input.genre, pointLabel: point.label, repeat },
          result.drafts,
        );

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
              critic: { names: input.materials.characterNames },
            });

            verdictFields = {
              auc: verdict.discarded ? undefined : verdict.auc.auc,
              discarded: verdict.discarded,
              ...(verdict.discarded ? { discardReasons: verdict.discardReasons } : {}),
              floorGate: verdict.floor,
              // 곡선은 폐기 여부와 무관하게 남긴다. 어디서 덮었는지가 곧 되짚을 단서다.
              panel: {
                byReader: verdict.auc.byReader,
                curves: verdict.auc.curves,
                dropOffScene: verdict.auc.dropOffScene,
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
                `${point.label} ${repeat}회 · 비평 관문 실패 (회차는 유지): ${verdict.critic.gate.reason}`,
              );
            }

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
                `${point.label} ${repeat}회 · 심판 회차 폐기: ${verdict.discardReasons.join(' / ')} · 원고: ${draftsDir}`,
              );
            }

            if (!verdict.floor.passed) {
              context.container.logger.warn(
                `${point.label} ${repeat}회 · 하한선 관문 실패 (회차는 유지): ${[...verdict.floor.failures, ...verdict.floor.abstained].join(' / ')}`,
              );
            }

            if (verdict.genreProblems.length > 0) {
              context.container.logger.warn(
                `${point.label} ${repeat}회 · 장르 독자 중단 (회차는 유지): ${verdict.genreProblems.join(' / ')}`,
              );
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
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
          scenes: result.metrics.scenes,
          tokens: result.tokens,
          ...verdictFields,
          draftsDir,
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

// 로컬 런타임에 없는 모델은 호출마다 404 로 죽고 실행기는 빈 기록을 쌓으며 끝까지 간다. 첫 호출 전에 본다.
async function refuseMissingLocalModels(input: {
  readonly generation: Selection;
  readonly judge?: Selection;
  readonly localRuntime: SimConfig['ollama'];
}): Promise<string | undefined> {
  const wanted = [input.generation, input.judge]
    .filter((selection): selection is Selection => selection?.providerId === 'ollama')
    .map((selection) => selection.model);

  if (wanted.length === 0) {
    return undefined;
  }

  const baseUrl = input.localRuntime?.baseUrl ?? 'http://127.0.0.1:11434';
  let available: readonly string[];

  try {
    available = await listLocalModels(baseUrl);
  } catch (error) {
    return `ollama 에 닿지 못했습니다 (${baseUrl}): ${error instanceof Error ? error.message : String(error)}`;
  }

  const missing = missingLocalModels(available, wanted);

  return missing.length === 0
    ? undefined
    : `ollama 에 없는 모델입니다: ${missing.join(', ')} (있는 것: ${available.join(', ') || '없음'}). ollama pull 로 받거나 sim.config 의 모델을 고치세요.`;
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

  const points: readonly DesignedPoint[] = [{ label: overlay.label, knobs: overlay.knobs }];
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

// 같은 지점·같은 생성을 두 엔진 이상으로 돌렸으면 앞 엔진 대비 움직임을 잡음 폭과 함께 보인다.
function regressionLines(runs: readonly RunRecord[]): readonly string[] {
  const rows = regressionRows(runs);

  return rows.length === 0
    ? []
    : ['', '[회귀: 앞 엔진 대비]', ...rows.map((row) => `  ${describeRegression(row)}`)];
}

function scoreKey(point: PointScore): string {
  return [point.genre, point.pointLabel, point.engineCommit, point.trackCommit].join('\u0000');
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
  const scored = scoreRuns(runs, axis);
  // 유효 회차가 없는 지점은 품질을 모른다. 경계에 올리면 AUC 0 인 지점으로 읽힌다.
  const frontier = paretoFrontier(scored.filter((point) => point.judged > 0));
  const frontierKeys = new Set(frontier.map((point) => scoreKey(point as PointScore)));
  const judgedRuns = scored.reduce((total, point) => total + point.judged, 0);

  // 엔진이나 트랙이 다른 기록이 한 파일에 섞이면 같은 지점 이름이 여러 줄 나온다. 어느 것인지 밝힌다.
  const fingerprints = new Set(scored.map((point) => `${point.engineCommit}@${point.trackCommit}`));
  const mixed = fingerprints.size > 1;
  const generations = new Set(scored.map((point) => point.generation));
  const mixedGeneration = generations.size > 1;

  // 시험체마다 따로 줄을 세운다. 장르를 섞으면 «싼 장르» 가 «이긴 손잡이» 로 읽힌다.
  const genres = [...new Set(scored.map((point) => point.genre))].sort();
  const lines = genres.flatMap((genre) => [
    '',
    `[${genre}]`,
    ...scored
      .filter((point) => point.genre === genre)
      .map((point) => {
        const mark = frontierKeys.has(scoreKey(point)) ? '*' : ' ';
        const cost = axis === 'usd' ? `$${point.cost.toFixed(4)}` : point.cost.toLocaleString();
        const name =
          (mixed
            ? `${point.pointLabel} @${point.engineCommit.slice(0, 7)}/${point.trackCommit.slice(0, 7)}`
            : point.pointLabel) + (mixedGeneration ? ` [${point.generation}]` : '');
        const quality =
          point.judged === 0
            ? `AUC n/a\t${cost}\t회수 n/a`
            : `AUC ${point.auc.toFixed(3)}\t${cost}\t회수 ${point.recalled}`;
        const critic =
          point.critic === undefined
            ? ''
            : `\t비평 ${point.critic.grounded}/20 의견 ${point.critic.opinion}/10 비평관문 ${point.critic.gatePassed}/${point.critic.runs}`;
        return `${mark} ${name}\t${quality}\t유효 ${point.judged}/${point.runs}\t관문 ${point.gatePassed}/${point.judged}${critic}`;
      }),
  ]);

  return {
    ok: true,
    message: [
      `실행 ${runs.length}회 (유효 ${judgedRuns}회) · 지점 ${scored.length}개 · 시험체 ${genres.length}개 (* 는 그 시험체의 파레토 경계)`,
      `비용 축: ${costAxisLabels[axis]}`,
      // 폐기 회차는 품질 축에서 뺀다. 0 으로 넣으면 셋 중 둘이 폐기된 지점이 «AUC 0» 으로 읽힌다.
      '품질 축은 유효 회차의 중앙값, 비용 축은 전체 회차의 중앙값 · 관문은 유효 회차 중 심판이 훼손본을 가려낸 수',
      ...(mixed ? ['엔진·트랙이 다른 기록은 따로 셉니다 (@엔진/트랙)'] : []),
      ...(mixedGeneration
        ? ['생성 모델·프롬프트 변형이 다른 기록은 따로 셉니다 ([프로바이더:모델/변형])']
        : []),
      // NOTE: 사람이 쓴 gt 가 아직 없어 상한선을 모른다. 점수를 «사람 글의 몇 퍼센트» 로 읽으면 안 된다.
      'ceiling: n/a',
      ...lines,
      ...regressionLines(runs),
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
  const judged = runs.filter(isJudged);

  if (runs.length === 0) {
    return refuse(`${point} 의 실행 기록이 없습니다.`);
  }

  // 폐기된 회차는 값이 없다. 돌았다고 세면 폐기 둘에 유효 하나인 지점이 프로필에 들어간다.
  if (judged.length < simDefaults.run.repeats) {
    return refuse(
      `${point} 은 유효 회차가 ${judged.length}회뿐입니다 (${runs.length}회 실행). 씨앗이 없어 회차마다 흔들리므로 ${simDefaults.run.repeats}회 이상의 중앙값이 필요합니다.`,
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

  const { fields, unsupported } = profileFieldsFor(knobs);

  if (unsupported.length > 0) {
    return refuse(`프로필 칸으로 옮길 수 없는 손잡이가 있습니다: ${unsupported.join(', ')}`);
  }

  const generation = runs[0]?.generation as RunRecord['generation'];
  const key = `${generation.providerId}:${generation.model}`;
  const judge = judged[0]?.judge;
  const measured = measurementFor(judged, {
    date: new Date().toISOString().slice(0, 10),
    ...(judge === undefined ? {} : { judge: `${judge.providerId}:${judge.model}` }),
  });
  const plan = [
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

  const profilesPath = requireFlag(context, 'profiles') ?? (await findModelProfilesFile());

  if (profilesPath === undefined) {
    return refuse(
      '엔진의 modelProfiles.params.json 을 찾지 못했습니다. 저장소 안에서 돌리거나 --profiles 로 경로를 주세요.',
    );
  }

  const result = await writeModelProfile(profilesPath, key, fields, measured, {
    force: flagBoolean(context.args.flags, 'force'),
  });

  if (!result.written) {
    return refuse(
      [
        `${key} 프로필이 이미 있습니다. 덮어쓰려면 --force 를 붙이세요.`,
        `  지금 값: ${JSON.stringify(result.previous)}`,
      ].join('\n'),
    );
  }

  return {
    ok: true,
    message: [...plan, `적었습니다: ${profilesPath}`, '검토 후 커밋하세요. 이 파일은 엔진 소스입니다.'].join('\n'),
    data: { point, key, fields, measured, file: profilesPath, runs: runs.length, judged: judged.length },
  };
};

// 실행 파일(dist/index.mjs) 자리에서 위로 올라가며 엔진 저장소의 프로필 파일을 찾는다.
async function findModelProfilesFile(): Promise<string | undefined> {
  let directory = dirname(process.argv[1] ?? process.cwd());

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, 'packages', 'story-ai', 'src', 'contracts', 'modelProfiles.params.json');
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {
      directory = dirname(directory);
    }
  }

  return undefined;
}
