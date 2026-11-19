import { createHash, randomUUID } from 'node:crypto';

import type { AiCallObservation } from '@storyboard/story-ai';
import {
  STORYBOARD_RELATIVE_PATHS,
  generationTraceFormatVersion,
  joinStoryPath,
  traceBlobRelativePath,
  traceCallRelativePath,
  traceRunHeaderRelativePath,
  traceRunHeaderSchema,
  traceRunRelativeDirectory,
  type StoryUri,
  type TraceCallRecord,
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
}

export interface TraceRunOpening {
  readonly kind: string;
  readonly subject?: TraceRunSubject;
}

export interface TraceRunSession {
  readonly runId: string | undefined;
  finish(status: TraceRunStatus, failureMessage?: string): Promise<void>;
}

interface OpenTraceRun {
  readonly header: TraceRunHeader;
  readonly isAmbient: boolean;
  readonly foldersCreated: Promise<void>;
  callCount: number;
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

      const opened: OpenTraceRun = await this.openRun(workspaceRoot, opening, { isAmbient: false });

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
      await run.foldersCreated;

      const record: TraceCallRecord = await this.buildCallRecord(workspaceRoot, run, sequence, observation);
      await this.writeJson(
        workspacePathOf(workspaceRoot, traceCallRelativePath(run.header.runId, sequence)),
        record,
      );
    });
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
      callCount: 0,
    };
    this.openRuns.set(workspaceRoot.toString(), run);

    await run.foldersCreated;
    await this.writeHeader(workspaceRoot, header);
    await this.removeRunsBeyondRetention(workspaceRoot, header);

    return run;
  }

  private async createRunFolders(workspaceRoot: StoryUri, runId: string): Promise<void> {
    for (const folder of ['calls', 'blobs']) {
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
    const runId: string = run.header.runId;
    const messages: TraceCallRecord['messages'] = await Promise.all(
      observation.messages.map(async (message) => ({
        role: message.role,
        ...(await this.storeText(workspaceRoot, runId, message.content)),
      })),
    );
    const response: TraceCallRecord['response'] =
      observation.response === undefined
        ? undefined
        : {
            ...(await this.storeText(workspaceRoot, runId, observation.response.text)),
            isTruncated: observation.response.isTruncated === true,
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

  private async storeText(workspaceRoot: StoryUri, runId: string, text: string): Promise<TraceTextRef> {
    const hash: string = createHash('sha256').update(text).digest('hex');
    const blobUri: StoryUri = workspacePathOf(workspaceRoot, traceBlobRelativePath(runId, hash));

    const isAlreadyStored: boolean = await this.dependencies.fileSystem.exists(blobUri);
    if (!isAlreadyStored) {
      await this.dependencies.fileSystem.writeFile(blobUri, new TextEncoder().encode(text));
    }

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
