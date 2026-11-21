import { createHash, randomUUID } from 'node:crypto';

import type { AiCallObservation } from '@storyboard/story-ai';
import {
  STORYBOARD_RELATIVE_PATHS,
  generationTraceFormatVersion,
  joinStoryPath,
  traceBlobRelativePath,
  traceCallRelativePath,
  traceEventRelativePath,
  tracePlanRelativePath,
  traceStageRelativePath,
  traceRunHeaderRelativePath,
  traceRunHeaderSchema,
  traceRunRelativeDirectory,
  type StoryUri,
  type TraceBeatVerdict,
  type TraceDialogueLineChange,
  type TraceCallRecord,
  type TraceEventKind,
  type TraceEventRecord,
  type TraceSectionLengthName,
  type TracePipelinePlan,
  type TraceStageRecord,
  type TraceRunHeader,
  type TraceRunStatus,
  type TraceRunSubject,
  type TraceTextRef,
} from '@storyboard/story-model';

import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';

export interface GenerationTraceRecorderDependencies {
  readonly fileSystem: IFileSystem;
  readonly logger: IStoryboardLogger;
  readonly isEnabled: () => boolean;
  readonly keepRunCount: () => number;
  readonly isFinalBeatCheckEnabled: () => boolean;
}

export interface TraceRunOpening {
  readonly kind: string;
  readonly subject?: TraceRunSubject;
  readonly continuesRunOfKind?: string;
}

export interface TraceRunSession {
  readonly runId: string | undefined;
  finish(status: TraceRunStatus, failureMessage?: string): Promise<void>;
}

type StageFailureReader<T> = (result: T) => string | undefined;

interface OpenTraceRun {
  readonly header: TraceRunHeader;
  readonly isAmbient: boolean;
  readonly foldersCreated: Promise<void>;
  readonly blobWrites: Map<string, Promise<void>>;
  callCount: number;
  eventCount: number;
  stageCount: number;
  openStage: OpenTraceStage | undefined;
}

export interface TraceEventObservation {
  readonly kind: TraceEventKind;
  readonly sectionIndex?: number;
  readonly attempt?: number;
  readonly rule?: string;
  readonly reasons?: readonly string[];
  readonly message?: string;
  readonly beforeText?: string;
  readonly afterText?: string;
  readonly lengths?: Readonly<Partial<Record<TraceSectionLengthName, number>>>;
  readonly beats?: readonly TraceBeatVerdict[];
  readonly beatNumbers?: readonly number[];
  readonly startOffset?: number;
  readonly subject?: string;
  readonly lines?: readonly TraceDialogueLineChange[];
}

interface OpenTraceStage {
  readonly sequence: number;
  readonly stageId: string;
  readonly startedAt: Date;
  readonly callCountAtStart: number;
}

const ambientRunKind: string = 'ambient';
const untracedSession: TraceRunSession = { runId: undefined, finish: async (): Promise<void> => {} };

function workspacePathOf(workspaceRoot: StoryUri, relativePath: string): StoryUri {
  return joinStoryPath(workspaceRoot, ...relativePath.split('/'));
}

function retentionGroupOf(header: TraceRunHeader): string {
  return `${header.kind}|${header.subject.sceneId ?? header.subject.sceneStem ?? ''}`;
}

function sortableRunIdAt(startedAt: Date): string {
  const timestamp: string = startedAt.toISOString().replace(/[-:.]/g, '');
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class GenerationTraceRecorder {
  private readonly openRuns: Map<string, OpenTraceRun> = new Map<string, OpenTraceRun>();
  private readonly lastClosedRuns: Map<string, OpenTraceRun> = new Map<string, OpenTraceRun>();
  private readonly openStageIds: Map<string, string> = new Map<string, string>();

  public constructor(private readonly dependencies: GenerationTraceRecorderDependencies) {}

  public async startRun(workspaceRoot: StoryUri, opening: TraceRunOpening): Promise<TraceRunSession> {
    if (!this.dependencies.isEnabled()) {
      return untracedSession;
    }

    const workspaceKey: string = workspaceRoot.toString();
    const current: OpenTraceRun | undefined = this.openRuns.get(workspaceKey);
    const isInsideAnotherRun: boolean = current !== undefined && !current.isAmbient;
    if (isInsideAnotherRun) {
      return untracedSession;
    }

    return await this.withoutFailingGeneration(untracedSession, async () => {
      if (current !== undefined) {
        await this.closeRun(workspaceRoot, current, 'completed');
      }

      const opened: OpenTraceRun =
        (await this.reopenRunToContinue(workspaceRoot, opening)) ??
        (await this.openRun(workspaceRoot, opening, { isAmbient: false }));

      return {
        runId: opened.header.runId,
        finish: (status: TraceRunStatus, failureMessage?: string): Promise<void> =>
          this.withoutFailingGeneration(undefined, () =>
            this.closeRun(workspaceRoot, opened, status, failureMessage),
          ),
      };
    });
  }

  public async recordCall(workspaceRoot: StoryUri, observation: AiCallObservation): Promise<void> {
    if (!this.dependencies.isEnabled()) {
      return;
    }

    await this.withoutFailingGeneration(undefined, async () => {
      const run: OpenTraceRun =
        this.openRuns.get(workspaceRoot.toString()) ??
        (await this.openRun(workspaceRoot, { kind: ambientRunKind }, { isAmbient: true }));
      run.callCount += 1;
      const sequence: number = run.callCount;
      const stageId: string | undefined = run.openStage?.stageId;
      await run.foldersCreated;

      const record: TraceCallRecord = await this.buildCallRecord(workspaceRoot, run, sequence, {
        ...observation,
        ...(stageId === undefined ? {} : { traceTag: { stage: stageId, ...observation.traceTag } }),
      });
      await this.writeJson(
        workspacePathOf(workspaceRoot, traceCallRelativePath(run.header.runId, sequence)),
        record,
      );
    });
  }

  public async recordPlan(workspaceRoot: StoryUri, plan: TracePipelinePlan): Promise<void> {
    const run: OpenTraceRun | undefined = this.findTracedRun(workspaceRoot);
    if (run === undefined) {
      return;
    }

    await this.withoutFailingGeneration(undefined, async () => {
      await run.foldersCreated;
      await this.writeJson(workspacePathOf(workspaceRoot, tracePlanRelativePath(run.header.runId)), plan);
    });
  }

  public shouldCheckFinalBeats(): boolean {
    return this.dependencies.isEnabled() && this.dependencies.isFinalBeatCheckEnabled();
  }

  public async recordEvent(workspaceRoot: StoryUri, observation: TraceEventObservation): Promise<void> {
    const run: OpenTraceRun | undefined = this.findTracedRun(workspaceRoot);
    if (run === undefined) {
      return;
    }

    run.eventCount += 1;
    const sequence: number = run.eventCount;
    const stageId: string | undefined = run.openStage?.stageId;
    const recordedAt: string = new Date().toISOString();

    await this.withoutFailingGeneration(undefined, async () => {
      await run.foldersCreated;
      const { beforeText, afterText, ...facts } = observation;
      const record: TraceEventRecord = {
        sequence,
        recordedAt,
        ...(stageId === undefined ? {} : { stage: stageId }),
        ...facts,
        ...(beforeText === undefined ? {} : { before: await this.storeText(workspaceRoot, run, beforeText) }),
        ...(afterText === undefined ? {} : { after: await this.storeText(workspaceRoot, run, afterText) }),
      };
      await this.writeJson(
        workspacePathOf(workspaceRoot, traceEventRelativePath(run.header.runId, sequence)),
        record,
      );
    });
  }

  public async runStage<T>(
    workspaceRoot: StoryUri,
    stageId: string,
    work: () => Promise<T>,
    readFailure: StageFailureReader<T> = (): undefined => undefined,
  ): Promise<T> {
    this.enterStage(workspaceRoot, stageId);

    try {
      const result: T = await work();
      const failureMessage: string | undefined = readFailure(result);
      await this.leaveStage(workspaceRoot, failureMessage === undefined ? undefined : new Error(failureMessage));
      return result;
    } catch (error) {
      await this.leaveStage(workspaceRoot, error);
      throw error;
    }
  }

  public currentStageOf(workspaceRoot: StoryUri): string | undefined {
    return this.openStageIds.get(workspaceRoot.toString());
  }

  public enterStage(workspaceRoot: StoryUri, stageId: string): void {
    this.openStageIds.set(workspaceRoot.toString(), stageId);
    const run: OpenTraceRun | undefined = this.findTracedRun(workspaceRoot);
    if (run === undefined) {
      return;
    }

    run.stageCount += 1;
    run.openStage = {
      sequence: run.stageCount,
      stageId,
      startedAt: new Date(),
      callCountAtStart: run.callCount,
    };
  }

  public async leaveStage(workspaceRoot: StoryUri, failure?: unknown): Promise<void> {
    this.openStageIds.delete(workspaceRoot.toString());
    const run: OpenTraceRun | undefined = this.findTracedRun(workspaceRoot);
    const stage: OpenTraceStage | undefined = run?.openStage;
    if (run === undefined || stage === undefined) {
      return;
    }

    run.openStage = undefined;
    const record: TraceStageRecord = {
      sequence: stage.sequence,
      stageId: stage.stageId,
      status: failure === undefined ? 'completed' : 'failed',
      startedAt: stage.startedAt.toISOString(),
      durationMs: Date.now() - stage.startedAt.getTime(),
      firstCallSequence: stage.callCountAtStart + 1,
      callCount: run.callCount - stage.callCountAtStart,
      ...(failure === undefined ? {} : { errorMessage: errorMessageOf(failure) }),
    };

    await this.withoutFailingGeneration(undefined, async () => {
      await run.foldersCreated;
      await this.writeJson(
        workspacePathOf(workspaceRoot, traceStageRelativePath(run.header.runId, stage.sequence)),
        record,
      );
    });
  }

  private findTracedRun(workspaceRoot: StoryUri): OpenTraceRun | undefined {
    const run: OpenTraceRun | undefined = this.openRuns.get(workspaceRoot.toString());
    return run === undefined || run.isAmbient ? undefined : run;
  }

  private async reopenRunToContinue(
    workspaceRoot: StoryUri,
    opening: TraceRunOpening,
  ): Promise<OpenTraceRun | undefined> {
    const closed: OpenTraceRun | undefined = this.lastClosedRuns.get(workspaceRoot.toString());
    const isRunToContinue: boolean =
      closed !== undefined &&
      opening.continuesRunOfKind === closed.header.kind &&
      opening.subject?.sceneStem !== undefined &&
      opening.subject.sceneStem === closed.header.subject.sceneStem;
    if (closed === undefined || !isRunToContinue) {
      return undefined;
    }

    this.lastClosedRuns.delete(workspaceRoot.toString());
    this.openRuns.set(workspaceRoot.toString(), closed);
    await this.writeHeader(workspaceRoot, closed.header);
    return closed;
  }

  private async openRun(
    workspaceRoot: StoryUri,
    opening: TraceRunOpening,
    options: { readonly isAmbient: boolean },
  ): Promise<OpenTraceRun> {
    const startedAt: Date = new Date();
    const header: TraceRunHeader = {
      version: generationTraceFormatVersion,
      runId: sortableRunIdAt(startedAt),
      kind: opening.kind,
      status: 'running',
      startedAt: startedAt.toISOString(),
      subject: opening.subject ?? {},
    };
    const run: OpenTraceRun = {
      header,
      isAmbient: options.isAmbient,
      foldersCreated: this.createRunFolders(workspaceRoot, header.runId),
      blobWrites: new Map<string, Promise<void>>(),
      callCount: 0,
      eventCount: 0,
      stageCount: 0,
      openStage: undefined,
    };
    this.openRuns.set(workspaceRoot.toString(), run);

    await run.foldersCreated;
    await this.writeHeader(workspaceRoot, header);
    await this.removeRunsBeyondRetention(workspaceRoot, header);

    return run;
  }

  private async createRunFolders(workspaceRoot: StoryUri, runId: string): Promise<void> {
    for (const folder of ['calls', 'stages', 'events', 'blobs']) {
      await this.dependencies.fileSystem.createDirectory(
        workspacePathOf(workspaceRoot, `${traceRunRelativeDirectory(runId)}/${folder}`),
      );
    }
  }

  private async closeRun(
    workspaceRoot: StoryUri,
    run: OpenTraceRun,
    status: TraceRunStatus,
    failureMessage?: string,
  ): Promise<void> {
    const workspaceKey: string = workspaceRoot.toString();
    if (this.openRuns.get(workspaceKey) === run) {
      this.openRuns.delete(workspaceKey);
    }

    const hasNothingToShow: boolean = run.callCount === 0;
    if (hasNothingToShow) {
      this.lastClosedRuns.delete(workspaceKey);
      await this.dependencies.fileSystem.delete(
        workspacePathOf(workspaceRoot, traceRunRelativeDirectory(run.header.runId)),
      );
      return;
    }
    if (!run.isAmbient) {
      this.lastClosedRuns.set(workspaceKey, run);
    }

    await this.writeHeader(workspaceRoot, {
      ...run.header,
      status,
      endedAt: new Date().toISOString(),
      ...(failureMessage === undefined ? {} : { failureMessage }),
    });
  }

  private async buildCallRecord(
    workspaceRoot: StoryUri,
    run: OpenTraceRun,
    sequence: number,
    observation: AiCallObservation,
  ): Promise<TraceCallRecord> {
    const messages: TraceCallRecord['messages'] = await Promise.all(
      observation.messages.map(async (message) => ({
        role: message.role,
        ...(await this.storeText(workspaceRoot, run, message.content)),
      })),
    );
    const response: TraceCallRecord['response'] =
      observation.response === undefined
        ? undefined
        : {
            ...(await this.storeText(workspaceRoot, run, observation.response.text)),
            isTruncated: observation.response.isTruncated === true,
            ...(observation.response.stopReason === undefined
              ? {}
              : { stopReason: observation.response.stopReason }),
          };

    return {
      sequence,
      taskName: observation.taskName,
      ...(observation.response === undefined ? {} : { providerId: observation.response.providerId }),
      ...(observation.response?.model === undefined ? {} : { model: observation.response.model }),
      startedAt: observation.startedAt.toISOString(),
      durationMs: observation.durationMs,
      parameters: {
        ...(observation.temperature === undefined ? {} : { temperature: observation.temperature }),
        ...(observation.maxTokens === undefined ? {} : { maxTokens: observation.maxTokens }),
        ...(observation.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: observation.reasoningEffort }),
      },
      messages,
      ...(response === undefined ? {} : { response }),
      ...(observation.error === undefined ? {} : { errorMessage: errorMessageOf(observation.error) }),
      ...(observation.response?.usage === undefined ? {} : { usage: observation.response.usage }),
      ...(observation.response?.costUsd === undefined ? {} : { costUsd: observation.response.costUsd }),
      ...(observation.traceTag === undefined ? {} : { tag: observation.traceTag }),
    };
  }

  private async storeText(workspaceRoot: StoryUri, run: OpenTraceRun, text: string): Promise<TraceTextRef> {
    const hash: string = createHash('sha256').update(text).digest('hex');
    const writeInFlight: Promise<void> =
      run.blobWrites.get(hash) ??
      this.dependencies.fileSystem.writeFile(
        workspacePathOf(workspaceRoot, traceBlobRelativePath(run.header.runId, hash)),
        new TextEncoder().encode(text),
      );
    run.blobWrites.set(hash, writeInFlight);
    await writeInFlight;

    return { hash, charCount: text.length };
  }

  private async removeRunsBeyondRetention(workspaceRoot: StoryUri, opened: TraceRunHeader): Promise<void> {
    const group: string = retentionGroupOf(opened);
    const earlierRunIds: string[] = (await this.readHeaders(workspaceRoot))
      .filter((header) => header.runId !== opened.runId && retentionGroupOf(header) === group)
      .map((header) => header.runId)
      .sort()
      .reverse();
    const earlierRunsToKeep: number = Math.max(this.dependencies.keepRunCount() - 1, 0);

    for (const runId of earlierRunIds.slice(earlierRunsToKeep)) {
      await this.dependencies.fileSystem.delete(
        workspacePathOf(workspaceRoot, traceRunRelativeDirectory(runId)),
      );
    }
  }

  private async readHeaders(workspaceRoot: StoryUri): Promise<readonly TraceRunHeader[]> {
    const entries: FileSystemDirectoryEntry[] = await this.dependencies.fileSystem.readDirectory(
      workspacePathOf(workspaceRoot, STORYBOARD_RELATIVE_PATHS.traceDirectory),
    );
    const headers: TraceRunHeader[] = [];

    for (const [name, entry] of entries) {
      const headerUri: StoryUri = workspacePathOf(workspaceRoot, traceRunHeaderRelativePath(name));
      if (entry.type !== 'directory' || !(await this.dependencies.fileSystem.exists(headerUri))) {
        continue;
      }

      const parsed: ReturnType<typeof traceRunHeaderSchema.safeParse> = traceRunHeaderSchema.safeParse(
        JSON.parse(new TextDecoder().decode(await this.dependencies.fileSystem.readFile(headerUri))),
      );
      if (parsed.success) {
        headers.push(parsed.data);
      }
    }

    return headers;
  }

  private async writeHeader(workspaceRoot: StoryUri, header: TraceRunHeader): Promise<void> {
    await this.writeJson(workspacePathOf(workspaceRoot, traceRunHeaderRelativePath(header.runId)), header);
  }

  private async writeJson(uri: StoryUri, value: unknown): Promise<void> {
    await this.dependencies.fileSystem.writeFile(uri, new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`));
  }

  private async withoutFailingGeneration<T>(fallback: T, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      this.dependencies.logger.warn(`생성 추적을 기록하지 못했습니다: ${errorMessageOf(error)}`);
      return fallback;
    }
  }
}
