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
  createFactRecallJudge,
  createSimJudge,
  judgeAxis,
  judgeChain,
  keepDrafts,
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
  type SimJudge,
  type BudgetEstimate,
  type TrackRef,
  type ISimWorkspaceFactory,
  type TrackRunResult,
  type AxisVerdict,
  type PanelVerdict,
  type FactRecallReport,
  type KnobSpec,
  type RejudgeSource,
  type BaselineSample,
  type SceneDraft,
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
  judgeUsageTotals,
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

interface ChainJudgement {
  readonly judgeRegistry: AiProviderRegistry;
  readonly judge: Selection;
  readonly generation: Selection;
  readonly materials: JudgeMaterials;
  readonly scenes: readonly TrackScene[];
  readonly drafts: ReadonlyMap<string, string>;
  readonly label: string;
  readonly draftsDir: string;
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
    const wantsJudge: boolean =
      !this.judgeDisabled() &&
      (this.flag('judge') !== undefined || prepared.config.judge !== undefined);
    let judge: Selection | undefined;
    let materials: JudgeMaterials | undefined;
    let judgeCallsPerRun: number = 0;

    if (wantsJudge) {
      const selected: string | Selection = this.judgeSelection(
        prepared.config,
        prepared.generation,
      );
      if (typeof selected === 'string') {
        return failure(selected);
      }
      const loaded: string | JudgeMaterials = await readJudgeMaterials(
        prepared.genreRoot,
        this.flag('genre') ?? 'unknown',
        prepared.scenes,
      );
      if (typeof loaded === 'string') {
        return failure(loaded);
      }
      judge = selected;
      materials = loaded;
      judgeCallsPerRun = simDefaults.panel.commonReaderCount * (prepared.scenes.length + 1);
    }

    const estimate: CommandOutcome | undefined = this.reportEstimate(
      points,
      judgeCallsPerRun,
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
      ...(judge === undefined ? {} : { judge }),
      ...(materials === undefined ? {} : { materials }),
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

    const names: string[] | undefined = this.flag('knobs')
      ?.split(',')
      .map((name) => name.trim());

    if (names === undefined || names.length !== 4) {
      return failure('--knobs 로 손잡이 넷을 정해 주세요. L9 격자는 넷을 요구합니다.');
    }

    const selected: (KnobSpec | undefined)[] = names.map(findKnob);
    if (selected.some((knob) => knob === undefined)) {
      return failure(`모르는 손잡이가 있습니다: ${names.join(', ')}`);
    }

    const knobs: readonly KnobSpec[] = selected as typeof knobRegistry;
    const levels: Map<string, readonly number[]> = new Map(
      knobs.map((knob) => [knob.id, defaultGridLevels(knob)]),
    );
    const points: readonly DesignedPoint[] = planFractionalGrid(knobs, levels);

    if (this.judgeDisabled()) {
      return failure(
        'sim sweep 은 심판 없이 돌지 않습니다. 격자의 품질 축이 비기 때문입니다. --judge none 은 sim run 에서만 씁니다.',
      );
    }

    const judge: string | Selection = this.judgeSelection(prepared.config, prepared.generation);
    if (typeof judge === 'string') {
      return failure(judge);
    }

    const materials: string | JudgeMaterials = await readJudgeMaterials(
      prepared.genreRoot,
      this.flag('genre') ?? 'unknown',
      prepared.scenes,
    );
    if (typeof materials === 'string') {
      return failure(materials);
    }

    const judgeCallsPerRun: number =
      simDefaults.panel.commonReaderCount * (prepared.scenes.length + 1);
    const estimate: CommandOutcome | undefined = this.reportEstimate(
      points,
      judgeCallsPerRun,
      prepared.generation,
      prepared.scenes.length,
      prepared.repeats,
    );
    if (estimate !== undefined) {
      return estimate;
    }

    return await this.executePoints({ ...prepared, points, judge, materials });
  }

  public async rejudge(): Promise<CommandOutcome> {
    const prepared: string | PreparedSim = await this.prepare();
    if (typeof prepared === 'string') {
      return failure(prepared);
    }

    const point: string = this.flag('point') ?? 'point';
    const selected: string | Selection = this.judgeSelection(prepared.config, prepared.generation);
    if (typeof selected === 'string') {
      return failure(selected);
    }

    const materials: string | JudgeMaterials = await readJudgeMaterials(
      prepared.genreRoot,
      prepared.genre,
      prepared.scenes,
    );
    if (typeof materials === 'string') {
      return failure(materials);
    }
    if (materials.axisFloors !== undefined) {
      return failure('축 트랙은 다시 채점하지 않습니다. 연쇄 트랙의 장르를 주세요.');
    }

    const runs: readonly RunRecord[] = await readRuns(prepared.outPath);
    const judge: Selection = { providerId: selected.providerId, model: selected.model };
    const engineVersion: string = this.context.container.version;
    const engineCommit: string = await this.describeEngineCommit(engineVersion);
    const sources: readonly RejudgeSource[] = rejudgeSources(runs, {
      pointLabel: point,
      engineCommit,
      ...(this.flag('source') === undefined ? {} : { enginePrefix: this.flag('source') }),
      judge,
    });

    if (sources.length === 0) {
      return failure(
        `${point} 에 다시 채점할 기록이 없습니다 (원고 자리가 있고 이 심판으로 아직 안 본 것).`,
      );
    }

    const localRefusal: string | undefined = await this.refuseMissingLocalModels({
      generation: selected,
      localRuntime: prepared.localRuntime,
    });
    if (localRefusal !== undefined) {
      return failure(localRefusal);
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

    if (!flagBoolean(this.context.args.flags, 'yes')) {
      return success([...plan, '이대로 돌리려면 --yes 를 붙이세요.'].join('\n'), {
        point,
        sources: sources.length,
      });
    }

    const judgeRegistry: AiProviderRegistry = this.judgeRegistryFor(prepared.localRuntime);

    let done: number = 0;
    for (const source of sources) {
      const drafts: Map<string, string> = await readKeptDrafts(
        join(dirname(prepared.outPath), source.draftsDir),
        prepared.scenes,
      );
      if (drafts.size === 0) {
        this.context.container.logger.warn(
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
        verdict = await this.judgeChainDrafts({
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
        this.context.container.logger.warn(`${source.run.runId} · 심판 실패: ${message}`);
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
      this.context.container.logger.info(
        `${record.runId}` +
          (record.auc === undefined ? ' · 폐기' : ` · AUC ${record.auc.toFixed(3)}`) +
          (record.recalled === undefined
            ? ''
            : ` · 회수 ${record.recalled}/${record.recallTotal}`) +
          (record.judgeTokens?.costUsd === undefined
            ? ''
            : ` · 심판 ${formatUsd(record.judgeTokens.costUsd)}`),
      );
    }

    return success(`다시 채점 ${done}회 완료 → ${prepared.outPath}`, {
      point,
      done,
      out: prepared.outPath,
    });
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
      logger: this.context.container.logger,
      version: this.context.container.version,
      provider: input.generation.providerId,
      model: input.generation.model,
      ...(input.localRuntime === undefined ? {} : { localRuntime: input.localRuntime }),
      ...(input.generation.promptVariant === undefined
        ? {}
        : { promptVariant: input.generation.promptVariant }),
    });

    const judgeRegistry: AiProviderRegistry = this.judgeRegistryFor(input.localRuntime);

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
          return failure(refusals.join('\n'));
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
              this.context.container.logger.info(
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
                this.context.container.logger.info(
                  `${verdict.sceneStem} · ${verdict.axis} · ${verdict.verdict}${verdict.discarded ? ` (폐기: ${verdict.discardReason ?? ''})` : ''}`,
                );
              }
            } else if (input.judge !== undefined && input.materials !== undefined) {
              verdictFields = await this.judgeChainDrafts({
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
            this.context.container.logger.warn(
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
          this.context.container.logger.info(
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

    return success(
      `실행 ${ran}회 완료${skipped > 0 ? ` (이미 끝난 ${skipped}회는 건너뜀)` : ''} → ${input.outPath}`,
      { ran, skipped, out: input.outPath, trackCommit: track.commit },
    );
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

  private async judgeChainDrafts(input: ChainJudgement): Promise<Partial<RunRecord>> {
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
      this.context.container.logger.warn(
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
      this.context.container.logger.warn(
        `${input.label} · 심판 회차 폐기: ${verdict.discardReasons.join(' / ')} · 원고: ${input.draftsDir}`,
      );
    }

    if (!verdict.floor.passed) {
      this.context.container.logger.warn(
        `${input.label} · 하한선 관문 실패 (회차는 유지): ${[...verdict.floor.failures, ...verdict.floor.abstained].join(' / ')}`,
      );
    }

    if (verdict.genreProblems.length > 0) {
      this.context.container.logger.warn(
        `${input.label} · 장르 독자 중단 (회차는 유지): ${verdict.genreProblems.join(' / ')}`,
      );
    }

    return { ...fields, judgeTokens: judgeUsageTotals(judge) };
  }
}
