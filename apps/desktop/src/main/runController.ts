import { hostname } from 'node:os';

import {
  acquireWorkspaceRunLock,
  describeWorkspaceRunLockHolder,
  getStoryboardProjectPaths,
  isResumable,
  isRunBudgetExceeded,
  novelStageNames,
  readProjectJson,
  readWorkspaceRunLock,
  scenePath,
  validateGenerationContract,
  type GenerateDraftRequest,
  type NovelApprovalKind,
  type NovelRunMode,
  type NovelRunState,
  type NovelStageName,
  type UsageMeterSession,
  type WorkspaceRunLock,
} from '@storyboard/story-engine';
import { contractFieldLabels, readSceneFile } from '@storyboard/story-format';

import type {
  RunApprovalRequest,
  RunKind,
  RunLogLine,
  RunOutcome,
  RunSnapshot,
  RunStatus,
} from '@/shared/dto';
import type { MessageKey, MessageParams } from '@/shared/i18n/translate';

import type { DesktopContainer } from './desktopContainer';
import { fail, succeed, type ServiceResult } from './serviceResult';

type SceneStage = Parameters<NonNullable<GenerateDraftRequest['onPipelineProgress']>>[0];

const maxLogLines = 300;

export interface RunControllerDependencies {
  readonly container: DesktopContainer;
  readonly translate: (key: MessageKey, params?: MessageParams) => string;
  readonly snapshot: (message: string) => Promise<void>;
  readonly onChange: (snapshot: RunSnapshot) => void;
}

interface ActiveRun {
  readonly kind: RunKind;
  readonly mode?: NovelRunMode;
  readonly sceneStem?: string;
  readonly lock: WorkspaceRunLock;
  readonly spending: UsageMeterSession;
  readonly budgetUsd: number;
  status: RunStatus;
  currentStage?: NovelStageName;
  furthestStageIndex: number;
  isPauseRequested: boolean;
  hasLoggedBudgetStop: boolean;
  approval?: RunApprovalRequest & { readonly resolve: (approved: boolean) => void };
  lastProgressMessage?: string;
  readonly finished: Promise<void>;
  readonly markFinished: () => void;
}

// Owns the one generation that may run in a workspace at a time: a whole novel or a single scene.
// Everything it does is reported as a RunSnapshot, which the drawer renders as is.
export class RunController {
  private active: ActiveRun | undefined;
  private log: RunLogLine[] = [];
  private lastOutcome: RunSnapshot['lastOutcome'];
  private resumable: RunSnapshot['resumable'];
  private projectSpentUsd = 0;
  // Settles after the last run's closing snapshot, which happens after the run stops being active.
  private lastRunFinished: Promise<void> = Promise.resolve();

  public constructor(private readonly dependencies: RunControllerDependencies) {}

  public get isBusy(): boolean {
    return this.active !== undefined;
  }

  public get generatingSceneStem(): string | undefined {
    return this.active?.sceneStem;
  }

  public get activeLockToken(): string | undefined {
    return this.active?.lock.record.token;
  }

  public async refresh(): Promise<RunSnapshot> {
    const { container } = this.dependencies;

    this.projectSpentUsd = (await container.usageLedger.getSummary(container.workspaceRoot)).total.costUsd;
    this.resumable = this.active === undefined ? await this.readResumable() : undefined;
    return this.snapshot();
  }

  public snapshot(): RunSnapshot {
    const run = this.active;
    const reading = run?.spending.reading();

    return {
      status: run?.status ?? 'idle',
      ...(run?.kind === undefined ? {} : { kind: run.kind }),
      ...(run?.mode === undefined ? {} : { mode: run.mode }),
      ...(run?.sceneStem === undefined ? {} : { sceneStem: run.sceneStem }),
      ...(run?.currentStage === undefined ? {} : { currentStage: run.currentStage }),
      completedStages: run === undefined ? [] : novelStageNames.slice(0, run.furthestStageIndex),
      ...(run?.approval === undefined ? {} : { approval: { kind: run.approval.kind, info: run.approval.info } }),
      log: this.log,
      spentUsd: reading?.costUsd ?? 0,
      spentTokens: reading?.tokens ?? 0,
      hasUnpricedUsage: reading?.hasUnpricedUsage ?? false,
      budgetUsd: this.dependencies.container.configBridge.getRunBudgetUsd(),
      projectSpentUsd: this.projectSpentUsd + (reading?.costUsd ?? 0),
      ...(this.lastOutcome === undefined ? {} : { lastOutcome: this.lastOutcome }),
      ...(this.resumable === undefined ? {} : { resumable: this.resumable }),
    };
  }

  public async startNovel(mode: NovelRunMode, resume: boolean): Promise<ServiceResult<RunSnapshot>> {
    const { container, translate } = this.dependencies;
    const paths = getStoryboardProjectPaths(container.workspaceRoot);
    const project = await readProjectJson(container.fileSystem, paths.projectJson);
    const readiness = validateGenerationContract(project.setting);

    if (readiness.missing.length > 0) {
      return fail(
        'contract-incomplete',
        translate('error.contractIncomplete', {
          fields: readiness.missing.map((key) => contractFieldLabels[key]).join(', '),
        }),
      );
    }

    const resumeState = resume ? await this.readResumableState() : undefined;
    const runMode = resumeState?.runMode ?? mode;
    const started = await this.begin({ kind: 'novel', mode: runMode, label: translate('lock.novel') });

    if (!started.ok) {
      return started;
    }

    const run = started.data;
    this.appendLog(
      translate(resumeState ? 'log.novelResumed' : 'log.novelStarted', {
        mode: translate(`run.mode.${runMode}`),
      }),
    );

    void this.finishWhenDone(
      run,
      container.novelPipeline
        .run({
          workspaceUri: container.workspaceRoot,
          project,
          runMode,
          ...(resumeState === undefined ? {} : { resumeState }),
          reviseMaxIterations: container.configBridge.getReviseMaxIterations(),
          onProgress: (stage, message) => this.recordProgress(run, stage, message),
          requestApproval: (kind, info) => this.askApproval(run, kind, info),
          // NOTE: 데스크톱은 취소를 쓰지 않는다. 멈춤은 모두 씬 경계에서 끝나는 shouldPause 로 간다.
          shouldCancel: () => false,
          shouldPause: () => this.shouldPause(run),
        })
        .then((result) => {
          const outcome: RunOutcome =
            result.outcome === 'paused' && this.isOverBudget(run) ? 'budget' : result.outcome;
          const message =
            outcome === 'budget'
              ? translate('run.outcome.budget', { budget: run.budgetUsd })
              : outcome === 'completed'
                ? translate('run.outcome.completed')
                : result.message;

          return { outcome, message, snapshotMessage: translate('snapshot.novelFinished', { message }) };
        }),
    );

    return succeed(this.snapshot());
  }

  public async generateScene(stem: string, force: boolean): Promise<ServiceResult<RunSnapshot>> {
    const { container, translate } = this.dependencies;

    if (!container.configBridge.isDefaultProviderConfigured()) {
      return fail('provider-missing', translate('error.providerMissing'));
    }

    const sceneUri = scenePath(container.workspaceRoot, stem);
    const scene = await readSceneFile(sceneUri, container.fileSystem, `${stem}.card`);
    const title = scene.card.title ?? scene.slug;
    const started = await this.begin({
      kind: 'scene',
      sceneStem: stem,
      label: translate('lock.scene', { title }),
    });

    if (!started.ok) {
      return started;
    }

    const run = started.data;
    this.appendLog(translate('log.sceneStarted', { title }));

    void this.finishWhenDone(run, this.writeScene(run, sceneUri, title, force));

    return succeed(this.snapshot());
  }

  public pause(): RunSnapshot {
    const run = this.active;

    if (run !== undefined && !run.isPauseRequested) {
      run.isPauseRequested = true;
      run.status = run.status === 'waiting-approval' ? run.status : 'pausing';
      this.appendLog(this.dependencies.translate('log.pauseRequested'));
      this.emit();
    }

    return this.snapshot();
  }

  public answerApproval(approved: boolean): RunSnapshot {
    const approval = this.active?.approval;

    if (this.active !== undefined && approval !== undefined) {
      this.active.approval = undefined;
      this.active.status = this.active.isPauseRequested ? 'pausing' : 'running';
      approval.resolve(approved);
      this.emit();
    }

    return this.snapshot();
  }

  // Resolves when nothing is running any more. The quit flow pauses first, then waits here.
  public async waitUntilIdle(): Promise<void> {
    await this.lastRunFinished;
  }

  private async begin(request: {
    readonly kind: RunKind;
    readonly mode?: NovelRunMode;
    readonly sceneStem?: string;
    readonly label: string;
  }): Promise<ServiceResult<ActiveRun>> {
    const { container, translate } = this.dependencies;

    if (this.active !== undefined) {
      return fail('run-active', translate('error.runActive'));
    }

    if (!container.configBridge.isDefaultProviderConfigured()) {
      return fail('provider-missing', translate('error.providerMissing'));
    }

    const acquired = await acquireWorkspaceRunLock({
      fileSystem: container.fileSystem,
      workspaceRoot: container.workspaceRoot,
      holder: { owner: 'desktop', label: request.label, pid: process.pid, hostname: hostname() },
    });

    if (!acquired.ok) {
      return fail('workspace-locked', describeWorkspaceRunLockHolder(acquired.heldBy));
    }

    let markFinished: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      markFinished = resolve;
    });
    const run: ActiveRun = {
      kind: request.kind,
      ...(request.mode === undefined ? {} : { mode: request.mode }),
      ...(request.sceneStem === undefined ? {} : { sceneStem: request.sceneStem }),
      lock: acquired.lock,
      spending: container.usageMeter.startSession(() => this.emit()),
      budgetUsd: container.configBridge.getRunBudgetUsd(),
      status: 'running',
      furthestStageIndex: 0,
      isPauseRequested: false,
      hasLoggedBudgetStop: false,
      finished,
      markFinished,
    };

    this.active = run;
    this.lastRunFinished = finished;
    this.lastOutcome = undefined;
    this.resumable = undefined;
    this.log = [];
    this.emit();

    return succeed(run);
  }

  private async finishWhenDone(
    run: ActiveRun,
    work: Promise<{ outcome: RunOutcome; message: string; snapshotMessage: string }>,
  ): Promise<void> {
    let outcome: RunOutcome;
    let message: string;
    let snapshotMessage: string | undefined;

    try {
      ({ outcome, message, snapshotMessage } = await work);
    } catch (error) {
      // NOTE: 실행 하나가 던진 예외가 앱을 멈추면 안 된다. 실패로 기록하고 잠금을 반드시 푼다.
      this.dependencies.container.logger.error('Desktop run failed', error);
      outcome = 'failed';
      message = error instanceof Error ? error.message : String(error);
    }

    run.spending.stop();
    await run.lock.release().catch(() => undefined);

    if (run.furthestStageIndex > 0 && outcome === 'completed') {
      run.furthestStageIndex = novelStageNames.length;
    }

    this.appendLog(message, outcome === 'failed' ? 'error' : outcome === 'completed' ? 'info' : 'warn');
    this.lastOutcome = { outcome, message };
    this.projectSpentUsd += run.spending.reading().costUsd;
    this.active = undefined;

    if (snapshotMessage !== undefined) {
      await this.dependencies.snapshot(snapshotMessage);
    }

    this.resumable = await this.readResumable();
    run.markFinished();
    this.emit();
  }

  private async writeScene(
    run: ActiveRun,
    sceneUri: ReturnType<typeof scenePath>,
    title: string,
    force: boolean,
  ): Promise<{ outcome: RunOutcome; message: string; snapshotMessage: string }> {
    const { container, translate } = this.dependencies;
    const shouldCancel = (): boolean => run.isPauseRequested;
    const result = await container.generateDraftUseCase.execute({
      sceneUri,
      force,
      // A writer is not asked to approve a fact sheet: the proposal is taken as written, like the
      // extension's auto-approve setting. The sheet stays in the scene card for later edits.
      confirmSceneGrounding: async ({ grounding }) => grounding,
      onPipelineProgress: (stage, current, total) =>
        this.appendLog(translate('log.sceneStage', { title, stage: this.sceneStageLabel(stage, current, total) })),
      shouldCancel,
    });
    const snapshotMessage = translate('snapshot.sceneGenerated', { title });

    if (!result.ok) {
      return result.kind === 'cancelled'
        ? { outcome: 'cancelled', message: translate('log.sceneStopped', { title }), snapshotMessage }
        : { outcome: 'failed', message: result.message, snapshotMessage };
    }

    if (result.kind === 'cache_hit') {
      return { outcome: 'completed', message: translate('log.sceneCached', { title }), snapshotMessage };
    }

    await container.reviseAfterGenerateGate.maybeRunAfterGenerate(sceneUri, {
      onProgress: (message) => this.appendLog(translate('log.sceneRevising', { title, message })),
      shouldCancel,
    });

    return { outcome: 'completed', message: translate('log.sceneSaved', { title }), snapshotMessage };
  }

  private sceneStageLabel(stage: SceneStage, current: number, total: number): string {
    const { translate } = this.dependencies;

    switch (stage) {
      case 'buildPersonas':
      case 'draftSkeleton':
      case 'polishDialogue':
      case 'attributeDialogue':
        return translate(`sceneStage.${stage}`);
      case 'expandSection':
        return translate('sceneStage.expandSection', { current, total });
      default:
        return translate('sceneStage.other');
    }
  }

  private recordProgress(run: ActiveRun, stage: NovelStageName, message: string): void {
    const stageIndex = novelStageNames.indexOf(stage);

    run.currentStage = stage;
    run.furthestStageIndex = Math.max(run.furthestStageIndex, stageIndex);

    // The step that just ended is on disk now; keep it as a version before the next one writes.
    if (run.lastProgressMessage !== undefined) {
      void this.dependencies.snapshot(
        this.dependencies.translate('snapshot.novelProgress', { message: run.lastProgressMessage }),
      );
    }

    run.lastProgressMessage = message;
    this.appendLog(message, 'info', stage);
  }

  private askApproval(run: ActiveRun, kind: NovelApprovalKind, info: string): Promise<boolean> {
    this.appendLog(this.dependencies.translate('log.approvalAsked', { info }), 'warn');

    return new Promise<boolean>((resolve) => {
      run.approval = { kind, info, resolve };
      run.status = 'waiting-approval';
      this.emit();
    });
  }

  private shouldPause(run: ActiveRun): boolean {
    if (run.isPauseRequested) {
      return true;
    }

    if (!this.isOverBudget(run)) {
      return false;
    }

    if (!run.hasLoggedBudgetStop) {
      run.hasLoggedBudgetStop = true;
      run.status = 'pausing';
      this.appendLog(this.dependencies.translate('log.budgetReached', { budget: run.budgetUsd }), 'warn');
    }

    return true;
  }

  private isOverBudget(run: ActiveRun): boolean {
    return isRunBudgetExceeded(run.spending.reading(), run.budgetUsd);
  }

  private async readResumable(): Promise<RunSnapshot['resumable']> {
    const state = await this.readResumableState();

    return state === undefined ? undefined : { mode: state.runMode, completedStages: state.completedStages };
  }

  // NOTE: 엔진의 isResumable 은 paused·failed 만 본다. 앱이 죽으면 상태가 running 으로 남는데,
  // 그것을 새 실행으로 다루면 아웃라인부터 다시 만든다. 쥔 앱이 없는 running 은 끊긴 실행이다.
  private async readResumableState(): Promise<NovelRunState | undefined> {
    const { container } = this.dependencies;
    const state = await container.novelRunStateRepository.readExisting(container.workspaceRoot);

    if (state === undefined || state.status !== 'running') {
      return isResumable(state) ? state : undefined;
    }

    if (this.active !== undefined) {
      return undefined;
    }

    const holder = await readWorkspaceRunLock({
      fileSystem: container.fileSystem,
      workspaceRoot: container.workspaceRoot,
    });

    return holder === undefined ? state : undefined;
  }

  private appendLog(message: string, tone: RunLogLine['tone'] = 'info', stage?: NovelStageName): void {
    const line: RunLogLine = {
      at: new Date().toISOString(),
      message,
      tone,
      ...(stage === undefined ? {} : { stage }),
    };

    this.log = [...this.log, line].slice(-maxLogLines);
    this.emit();
  }

  private emit(): void {
    this.dependencies.onChange(this.snapshot());
  }
}
