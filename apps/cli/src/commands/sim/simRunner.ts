import { dirname, join } from 'node:path';
import {
  storyboardModelCatalog,
  extractErrorMessage,
  formatUsd,
  type AiProviderId,
} from '@storyboard/story-model';
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
  keepDrafts,
  defaultGridLevels,
  describeCost,
  describeEngine,
  describeTrack,
  estimateBudget,
  findKnob,
  knobRegistry,
  listLocalModels,
  missingLocalModels,
  planFractionalGrid,
  planScreening,
  promptVariantSchema,
  readRuns,
  rejudgeSources,
  rejudgedRecord,
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
  type SimConfig,
  type BudgetEstimate,
  type TrackRef,
  type ISimWorkspaceFactory,
  type TrackRunResult,
  type OverlayApplication,
  type KnobSpec,
  type RejudgeSource,
  type BaselineSample,
} from '@storyboard/story-sim';
import type { ZodSafeParseResult } from 'zod';
import { flagBoolean, flagString } from '@/cliArguments';
import { createSimWorkspaceFactory } from '@/adapters/simWorkspaceFactory';
import { createCliContainer } from '@/container';
import { availableProviderIds, isAvailableProviderId } from '@/adapters/availableProviders';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import {
  generationRecord,
  loadOverlayPoint,
  readJudgeMaterials,
  readKeptDrafts,
  readTrackScenes,
  resolveGenreRoot,
  type JudgeMaterials,
  type OverlayPoint,
  type Selection,
  type TrackScene,
} from './simTrack';
import { SimRunJudging } from './simRunJudging';

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

interface PointExecution {
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
}

interface LocalModelDemand {
  readonly generation: Selection;
  readonly judge?: Selection;
  readonly localRuntime: SimConfig['ollama'];
}

const noJudge: string = 'none';

const unmeasuredBaselineUntilTheFirstRun: BaselineSample = {
  generationCallsPerScene: 7,
  inputTokensPerCall: 4000,
  outputTokensPerCall: 1500,
  secondsPerCall: 30,
  measuredAt: '미실측 (기본 추정)',
};

interface JudgeSetup {
  readonly judge: Selection;
  readonly materials: JudgeMaterials;
  readonly callsPerRun: number;
}

interface RejudgeRun {
  readonly prepared: PreparedSim;
  readonly selected: Selection;
  readonly judge: Selection;
  readonly materials: JudgeMaterials;
  readonly engineCommit: string;
  readonly engineVersion: string;
  readonly sources: readonly RejudgeSource[];
}

interface PointRun {
  readonly input: PointExecution;
  readonly track: TrackRef;
  readonly engineCommit: string;
  readonly engineVersion: string;
  readonly factory: ISimWorkspaceFactory;
  readonly judging: SimRunJudging;
}

interface RepeatRef {
  readonly point: DesignedPoint;
  readonly repeat: number;
}

interface RepeatOutput {
  readonly trackRun: TrackRunResult;
  readonly draftsDir: string;
  readonly verdictFields: Partial<RunRecord>;
  readonly startedAt: string;
}

class PointRunTally {
  private ran: number = 0;
  private skipped: number = 0;

  public recordRan(): void {
    this.ran += 1;
  }

  public recordSkipped(): void {
    this.skipped += 1;
  }

  public toOutcome(outPath: string, trackCommit: string): CommandOutcome {
    return success(
      `실행 ${this.ran}회 완료${this.skipped > 0 ? ` (이미 끝난 ${this.skipped}회는 건너뜀)` : ''} → ${outPath}`,
      { ran: this.ran, skipped: this.skipped, out: outPath, trackCommit },
    );
  }
}

function countJudgeCallsPerRun(sceneCount: number): number {
  return simDefaults.panel.commonReaderCount * (sceneCount + 1);
}

function describeRejudgePlan(point: string, rejudgeRun: RejudgeRun): string[] {
  const { sources, judge } = rejudgeRun;
  const judgeCalls: number =
    sources.length *
    (simDefaults.panel.commonReaderCount + 1) *
    (rejudgeRun.prepared.scenes.length + 2);

  return [
    `${point} 의 ${sources.length}회를 ${judge.providerId}:${judge.model} 으로 다시 채점합니다.`,
    ...sources.map(
      (source) =>
        `  ${source.run.runId} (${source.run.engineCommit.slice(0, 7)}, 원고 ${source.draftsDir})`,
    ),
    `심판 호출 약 ${judgeCalls.toLocaleString()}회. 생성은 하지 않습니다.`,
  ];
}

function describeRejudgedRecord(record: RunRecord): string {
  return (
    `${record.runId}` +
    (record.auc === undefined ? ' · 폐기' : ` · AUC ${record.auc.toFixed(3)}`) +
    (record.recalled === undefined ? '' : ` · 회수 ${record.recalled}/${record.recallTotal}`) +
    (record.judgeTokens?.costUsd === undefined
      ? ''
      : ` · 심판 ${formatUsd(record.judgeTokens.costUsd)}`)
  );
}

function describeRepeatRecord(
  { point, repeat }: RepeatRef,
  trackRun: TrackRunResult,
  record: RunRecord,
): string {
  return (
    `${point.label} ${repeat}회 · 도달률 ${trackRun.metrics.meanReach.toFixed(3)} · ${describeCost(trackRun.tokens)}` +
    (record.auc === undefined ? '' : ` · AUC ${record.auc.toFixed(3)}`) +
    (record.recalled === undefined ? '' : ` · 회수 ${record.recalled}/${record.recallTotal}`)
  );
}

function createRepeatRecord(
  pointRun: PointRun,
  { point, repeat }: RepeatRef,
  output: RepeatOutput,
): RunRecord {
  const { input, track } = pointRun;

  return {
    runId: runKey(input.genre, point.label, repeat),
    genre: input.genre,
    pointLabel: point.label,
    repeat,
    engineCommit: pointRun.engineCommit,
    engineVersion: pointRun.engineVersion,
    trackCommit: track.commit,
    trackDirty: false,
    knobs: point.knobs,
    generation: generationRecord(input.generation, input.localRuntime),
    ...(input.judge === undefined
      ? {}
      : { judge: { providerId: input.judge.providerId, model: input.judge.model } }),
    scenes: output.trackRun.metrics.scenes,
    tokens: output.trackRun.tokens,
    ...output.verdictFields,
    draftsDir: output.draftsDir,
    startedAt: output.startedAt,
    wallClockMs: output.trackRun.wallClockMs,
  };
}

async function loadChainMaterials(prepared: PreparedSim): Promise<string | JudgeMaterials> {
  const materials: string | JudgeMaterials = await readJudgeMaterials(
    prepared.genreRoot,
    prepared.genre,
    prepared.scenes,
  );
  if (typeof materials === 'string') {
    return materials;
  }

  return materials.axisFloors === undefined
    ? materials
    : '축 트랙은 다시 채점하지 않습니다. 연쇄 트랙의 장르를 주세요.';
}

export class SimRunner {
  public constructor(private readonly context: CommandContext) {}

  public async run(): Promise<CommandOutcome> {
    const prepared: string | PreparedSim = await this.prepare();
    if (typeof prepared === 'string') {
      return failure(prepared);
    }

    const overlay: OverlayPoint = await loadOverlayPoint(
      this.flag('overlay'),
      prepared.generation.providerId,
    );
    if (overlay.refusals.length > 0) {
      return failure(overlay.refusals.join('\n'));
    }

    const points: readonly DesignedPoint[] = [{ label: overlay.label, knobs: overlay.knobs }];
    const judging: string | JudgeSetup | undefined = this.wantsJudge(prepared.config)
      ? await this.prepareJudge(prepared)
      : undefined;
    if (typeof judging === 'string') {
      return failure(judging);
    }

    const estimate: CommandOutcome | undefined = this.reportEstimate(
      points,
      judging?.callsPerRun ?? 0,
      prepared.generation,
      prepared.scenes.length,
      prepared.repeats,
    );
    if (estimate !== undefined) {
      return estimate;
    }

    return await this.executePoints({
      ...prepared,
      points,
      ...(judging === undefined ? {} : { judge: judging.judge, materials: judging.materials }),
    });
  }

  public async screen(): Promise<CommandOutcome> {
    const prepared: string | PreparedSim = await this.prepare();
    if (typeof prepared === 'string') {
      return failure(prepared);
    }

    const names: string[] | undefined = this.flag('knobs')
      ?.split(',')
      .map((name) => name.trim());
    const selected: readonly KnobSpec[] | (KnobSpec | undefined)[] =
      names === undefined ? knobRegistry : names.map(findKnob);

    if (selected.some((knob) => knob === undefined)) {
      return failure(`모르는 손잡이가 있습니다: ${names?.join(', ')}`);
    }

    const points: readonly DesignedPoint[] = planScreening(selected as typeof knobRegistry);
    const estimate: CommandOutcome | undefined = this.reportEstimate(
      points,
      0,
      prepared.generation,
      prepared.scenes.length,
      prepared.repeats,
    );
    if (estimate !== undefined) {
      return estimate;
    }

    return await this.executePoints({ ...prepared, points });
  }

  public async sweep(): Promise<CommandOutcome> {
    const prepared: string | PreparedSim = await this.prepare();
    if (typeof prepared === 'string') {
      return failure(prepared);
    }

    const points: string | readonly DesignedPoint[] = this.planSweepPoints();
    if (typeof points === 'string') {
      return failure(points);
    }

    if (this.judgeDisabled()) {
      return failure(
        'sim sweep 은 심판 없이 돌지 않습니다. 격자의 품질 축이 비기 때문입니다. --judge none 은 sim run 에서만 씁니다.',
      );
    }

    const judging: string | JudgeSetup = await this.prepareJudge(prepared);
    if (typeof judging === 'string') {
      return failure(judging);
    }

    const estimate: CommandOutcome | undefined = this.reportEstimate(
      points,
      judging.callsPerRun,
      prepared.generation,
      prepared.scenes.length,
      prepared.repeats,
    );
    if (estimate !== undefined) {
      return estimate;
    }

    return await this.executePoints({
      ...prepared,
      points,
      judge: judging.judge,
      materials: judging.materials,
    });
  }

  public async rejudge(): Promise<CommandOutcome> {
    const prepared: string | PreparedSim = await this.prepare();
    if (typeof prepared === 'string') {
      return failure(prepared);
    }

    const point: string = this.flag('point') ?? 'point';
    const rejudgeRun: string | RejudgeRun = await this.prepareRejudge(prepared, point);
    if (typeof rejudgeRun === 'string') {
      return failure(rejudgeRun);
    }

    if (!flagBoolean(this.context.args.flags, 'yes')) {
      return success(
        [...describeRejudgePlan(point, rejudgeRun), '이대로 돌리려면 --yes 를 붙이세요.'].join(
          '\n',
        ),
        { point, sources: rejudgeRun.sources.length },
      );
    }

    const done: number = await this.rejudgeSources(rejudgeRun);

    return success(`다시 채점 ${done}회 완료 → ${prepared.outPath}`, {
      point,
      done,
      out: prepared.outPath,
    });
  }

  private wantsJudge(config: SimConfig): boolean {
    return (
      !this.judgeDisabled() && (this.flag('judge') !== undefined || config.judge !== undefined)
    );
  }

  private async prepareJudge(prepared: PreparedSim): Promise<string | JudgeSetup> {
    const judge: string | Selection = this.judgeSelection(prepared.config, prepared.generation);
    if (typeof judge === 'string') {
      return judge;
    }

    const materials: string | JudgeMaterials = await readJudgeMaterials(
      prepared.genreRoot,
      this.flag('genre') ?? 'unknown',
      prepared.scenes,
    );
    if (typeof materials === 'string') {
      return materials;
    }

    return { judge, materials, callsPerRun: countJudgeCallsPerRun(prepared.scenes.length) };
  }

  private planSweepPoints(): string | readonly DesignedPoint[] {
    const names: string[] | undefined = this.flag('knobs')
      ?.split(',')
      .map((name) => name.trim());

    if (names === undefined || names.length !== 4) {
      return '--knobs 로 손잡이 넷을 정해 주세요. L9 격자는 넷을 요구합니다.';
    }

    const selected: (KnobSpec | undefined)[] = names.map(findKnob);
    if (selected.some((knob) => knob === undefined)) {
      return `모르는 손잡이가 있습니다: ${names.join(', ')}`;
    }

    const knobs: readonly KnobSpec[] = selected as typeof knobRegistry;
    const levels: Map<string, readonly number[]> = new Map(
      knobs.map((knob) => [knob.id, defaultGridLevels(knob)]),
    );
    return planFractionalGrid(knobs, levels);
  }

  private async prepareRejudge(prepared: PreparedSim, point: string): Promise<string | RejudgeRun> {
    const selected: string | Selection = this.judgeSelection(prepared.config, prepared.generation);
    if (typeof selected === 'string') {
      return selected;
    }

    const materials: string | JudgeMaterials = await loadChainMaterials(prepared);
    if (typeof materials === 'string') {
      return materials;
    }

    const runs: readonly RunRecord[] = await readRuns(prepared.outPath);
    const judge: Selection = { providerId: selected.providerId, model: selected.model };
    const engineVersion: string = this.context.container.version;
    const engineCommit: string = await this.describeEngineCommit(engineVersion);
    const sources: readonly RejudgeSource[] = this.findRejudgeSources(
      runs,
      point,
      engineCommit,
      judge,
    );

    if (sources.length === 0) {
      return `${point} 에 다시 채점할 기록이 없습니다 (원고 자리가 있고 이 심판으로 아직 안 본 것).`;
    }

    const localRefusal: string | undefined = await this.refuseMissingLocalModels({
      generation: selected,
      localRuntime: prepared.localRuntime,
    });

    return (
      localRefusal ?? { prepared, selected, judge, materials, engineCommit, engineVersion, sources }
    );
  }

  private findRejudgeSources(
    runs: readonly RunRecord[],
    point: string,
    engineCommit: string,
    judge: Selection,
  ): readonly RejudgeSource[] {
    return rejudgeSources(runs, {
      pointLabel: point,
      engineCommit,
      ...(this.flag('source') === undefined ? {} : { enginePrefix: this.flag('source') }),
      judge,
    });
  }

  private async rejudgeSources(rejudgeRun: RejudgeRun): Promise<number> {
    const judging: SimRunJudging = this.createJudging(rejudgeRun.prepared.localRuntime);
    let done: number = 0;

    for (const source of rejudgeRun.sources) {
      const isRejudged: boolean = await this.rejudgeSource(source, rejudgeRun, judging);
      if (isRejudged) {
        done += 1;
      }
    }

    return done;
  }

  private async rejudgeSource(
    source: RejudgeSource,
    rejudgeRun: RejudgeRun,
    judging: SimRunJudging,
  ): Promise<boolean> {
    const { prepared } = rejudgeRun;
    const drafts: Map<string, string> = await readKeptDrafts(
      join(dirname(prepared.outPath), source.draftsDir),
      prepared.scenes,
    );
    if (drafts.size === 0) {
      this.context.container.logger.warn(
        `${source.run.runId} · 원고를 찾지 못했습니다: ${source.draftsDir}`,
      );
      return false;
    }

    const verdict: Partial<RunRecord> = await judging.judgeKeptDrafts({
      source,
      judge: rejudgeRun.selected,
      materials: rejudgeRun.materials,
      scenes: prepared.scenes,
      drafts,
    });
    const record: RunRecord = rejudgedRecord(source.run, {
      engineCommit: rejudgeRun.engineCommit,
      engineVersion: rejudgeRun.engineVersion,
      judge: rejudgeRun.judge,
      verdict,
      startedAt: new Date().toISOString(),
    });
    await appendRun(prepared.outPath, record);
    this.context.container.logger.info(describeRejudgedRecord(record));
    return true;
  }

  private flag(name: string): string | undefined {
    return flagString(this.context.args.flags, name);
  }

  private async prepare(): Promise<string | PreparedSim> {
    const trackRoot: string | undefined = this.flag('track');

    if (trackRoot === undefined) {
      return '--track 으로 트랙 저장소를 지정해 주세요.';
    }

    const config: SimConfig = await readSimConfig(
      this.flag('config') ?? join(trackRoot, simConfigFileName),
    );
    const genreRoot: string = resolveGenreRoot(trackRoot, this.flag('genre'));
    const scenes: readonly TrackScene[] = await readTrackScenes(genreRoot);
    const generation: string | Selection = this.generationSelection(config);

    if (typeof generation === 'string') {
      return generation;
    }

    return {
      trackRoot,
      genreRoot,
      scenes,
      generation,
      outPath: this.flag('out') ?? join(trackRoot, simResultsDirectory, 'runs.jsonl'),
      config,
      repeats: this.repeats(config),
      localRuntime: config.ollama,
      genre: this.flag('genre') ?? 'track',
    };
  }

  private generationSelection(config: SimConfig): Selection | string {
    const flagProvider: string | undefined = this.flag('provider');
    const flagModel: string | undefined = this.flag('model');
    const rawVariant: string | undefined =
      this.flag('prompt-variant') ?? config.generation?.promptVariant;
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

    const providerId: AiProviderId =
      this.context.container.configBridge.getTaskProvider('sceneDraft');
    return withVariant({
      providerId,
      model: flagModel ?? this.context.container.configBridge.getTaskAiConfig('sceneDraft').model,
    });
  }

  private judgeDisabled(): boolean {
    return this.flag('judge') === noJudge;
  }

  private judgeSelection(config: SimConfig, generation: Selection): Selection | string {
    const rawProvider: string | undefined = this.flag('judge') ?? config.judge?.provider;

    if (rawProvider === undefined) {
      return `--judge 로 심판을 정하거나 ${simConfigFileName} 에 judge 를 적어 주세요. 생성과 같은 모델이면 자기 글을 자기가 채점하게 됩니다.`;
    }

    if (!isAvailableProviderId(rawProvider)) {
      return `알 수 없는 심판 프로바이더: ${rawProvider}\n쓸 수 있는 값: ${availableProviderIds().join(', ')}`;
    }

    const model: string =
      this.flag('judge-model') ??
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

  private repeats(config: SimConfig): number {
    const flag: string | undefined = this.flag('repeats');
    return flag === undefined ? (config.repeats ?? simDefaults.run.repeats) : Number(flag);
  }

  private reportEstimate(
    points: readonly DesignedPoint[],
    judgeCallsPerRun: number,
    generation: Selection,
    sceneCount: number,
    repeats: number,
  ): CommandOutcome | undefined {
    const maxRuns: string | undefined = this.flag('max-runs');

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
      return failure(
        `실행 ${estimate.points * estimate.repeats}회는 --max-runs ${maxRuns} 를 넘습니다.`,
      );
    }

    if (flagBoolean(this.context.args.flags, 'yes')) {
      return undefined;
    }

    const cost: string =
      estimate.estimatedUsd === undefined ? '금액 불명' : formatUsd(estimate.estimatedUsd);

    return success(
      [
        `지점 ${estimate.points} × ${estimate.repeats}회 = 실행 ${estimate.points * estimate.repeats}회`,
        `생성 호출 ${estimate.generationCalls.toLocaleString()} · 심판 호출 ${estimate.judgeCalls.toLocaleString()}`,
        `예상 비용 ${cost} · 예상 시간 ${estimate.estimatedWallClockHours.toFixed(1)}시간`,
        '',
        ...estimate.assumptions.map((line) => `  ${line}`),
        '',
        '이대로 돌리려면 --yes 를 붙이세요.',
      ].join('\n'),
      estimate,
    );
  }

  private createJudging(localRuntime: SimConfig['ollama']): SimRunJudging {
    return new SimRunJudging({
      logger: this.context.container.logger,
      registry: this.judgeRegistryFor(localRuntime),
    });
  }

  private async describeEngineCommit(engineVersion: string): Promise<string> {
    return await describeEngine(dirname(process.argv[1] ?? process.cwd()), engineVersion);
  }

  private judgeRegistryFor(localRuntime: SimConfig['ollama']): AiProviderRegistry {
    if (localRuntime === undefined) {
      return this.context.container.aiProviderRegistry;
    }

    return createCliContainer({
      workspacePath: this.context.container.workspaceRoot.fsPath,
      logger: this.context.container.logger,
      canPrompt: false,
      version: this.context.container.version,
      localRuntime: {
        ...(localRuntime.baseUrl === undefined ? {} : { baseUrl: localRuntime.baseUrl }),
        ...(localRuntime.contextTokens === undefined
          ? {}
          : { contextTokens: localRuntime.contextTokens }),
      },
    }).aiProviderRegistry;
  }

  private async executePoints(input: PointExecution): Promise<CommandOutcome> {
    const track: TrackRef = await describeTrack(input.trackRoot);

    if (track.dirty) {
      return failure(
        '트랙에 커밋하지 않은 변경이 있습니다. 기록한 커밋이 실제 입력을 설명하지 못하므로 먼저 정리해 주세요.',
      );
    }

    const localRefusal: string | undefined = await this.refuseMissingLocalModels(input);
    if (localRefusal !== undefined) {
      return failure(localRefusal);
    }

    const engineVersion: string = this.context.container.version;
    const engineCommit: string = await this.describeEngineCommit(engineVersion);
    const done: ReadonlySet<string> = await completedKeys(input.outPath, {
      engineCommit,
      trackCommit: track.commit,
      generation: generationRecord(input.generation, input.localRuntime),
      ...(input.judge === undefined
        ? {}
        : { judge: { providerId: input.judge.providerId, model: input.judge.model } }),
    });
    const pointRun: PointRun = {
      input,
      track,
      engineCommit,
      engineVersion,
      factory: this.createWorkspaceFactory(input),
      judging: this.createJudging(input.localRuntime),
    };

    return await this.executeOpenRepeats(pointRun, done);
  }

  private createWorkspaceFactory(input: PointExecution): ISimWorkspaceFactory {
    return createSimWorkspaceFactory({
      logger: this.context.container.logger,
      version: this.context.container.version,
      provider: input.generation.providerId,
      model: input.generation.model,
      ...(input.localRuntime === undefined ? {} : { localRuntime: input.localRuntime }),
      ...(input.generation.promptVariant === undefined
        ? {}
        : { promptVariant: input.generation.promptVariant }),
    });
  }

  private async executeOpenRepeats(
    pointRun: PointRun,
    done: ReadonlySet<string>,
  ): Promise<CommandOutcome> {
    const { input } = pointRun;
    const tally: PointRunTally = new PointRunTally();

    for (const point of input.points) {
      for (let repeat: number = 1; repeat <= input.repeats; repeat += 1) {
        if (done.has(runKey(input.genre, point.label, repeat))) {
          tally.recordSkipped();
          continue;
        }

        const refusal: string | undefined = await this.executeRepeat(pointRun, { point, repeat });
        if (refusal !== undefined) {
          return failure(refusal);
        }
        tally.recordRan();
      }
    }

    return tally.toOutcome(input.outPath, pointRun.track.commit);
  }

  private async executeRepeat(pointRun: PointRun, ref: RepeatRef): Promise<string | undefined> {
    const { input } = pointRun;
    const { tuning, promptOverrides, sectionOutputLimit, refusals }: OverlayApplication =
      applyOverlay({ knobs: ref.point.knobs }, input.generation.providerId);

    if (refusals.length > 0) {
      return refusals.join('\n');
    }

    const scratch: string = await copyToScratch(input.genreRoot);

    try {
      const startedAt: string = new Date().toISOString();
      const trackRun: TrackRunResult = await runTrack({
        factory: pointRun.factory,
        workspacePath: scratch,
        scenes: input.scenes,
        tuning,
        promptOverrides,
        ...(sectionOutputLimit === undefined ? {} : { sectionOutputLimit }),
        onProgress: (stem, current, total) =>
          this.context.container.logger.info(
            `${ref.point.label} ${ref.repeat}회 · ${current}/${total} ${stem}`,
          ),
      });
      await this.recordRepeat(pointRun, ref, trackRun, startedAt);
    } finally {
      await removeScratch(scratch);
    }

    return undefined;
  }

  private async recordRepeat(
    pointRun: PointRun,
    ref: RepeatRef,
    trackRun: TrackRunResult,
    startedAt: string,
  ): Promise<void> {
    const { input } = pointRun;
    const draftsDir: string = await keepDrafts(
      input.outPath,
      { genre: input.genre, pointLabel: ref.point.label, repeat: ref.repeat },
      trackRun.drafts,
    );
    const verdictFields: Partial<RunRecord> = await pointRun.judging.judgeRepeat({
      judge: input.judge,
      materials: input.materials,
      generation: input.generation,
      scenes: input.scenes,
      drafts: trackRun.drafts,
      label: `${ref.point.label} ${ref.repeat}회`,
      draftsDir,
    });
    const record: RunRecord = createRepeatRecord(pointRun, ref, {
      trackRun,
      draftsDir,
      verdictFields,
      startedAt,
    });

    await appendRun(input.outPath, record);
    this.context.container.logger.info(describeRepeatRecord(ref, trackRun, record));
  }

  private async refuseMissingLocalModels(input: LocalModelDemand): Promise<string | undefined> {
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
}
