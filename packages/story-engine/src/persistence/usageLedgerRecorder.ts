import { randomUUID } from 'node:crypto';

import type {
  DisposableHandle,
  StoryUri,
  UsageLedgerEntry,
  UsageRecord,
  UsageSummaryByEntity,
} from '@storyboard/story-model';

import type { IUsageSink } from '#engine/ports/usageSink';
import { UsageStore } from '#engine/persistence/cache/usageStore';
import type { WorkspaceCaches } from '#engine/persistence/cache/workspaceCaches';

export interface UsageLedgerRecorderDependencies {
  readonly caches: WorkspaceCaches;
}

export class UsageLedgerRecorder implements IUsageSink {
  private readonly listeners: Set<() => void> = new Set<() => void>();

  public constructor(private readonly dependencies: UsageLedgerRecorderDependencies) {}

  public onChange(listener: () => void): DisposableHandle {
    this.listeners.add(listener);
    return { dispose: (): void => void this.listeners.delete(listener) };
  }

  public async record(workspaceRoot: StoryUri, record: UsageRecord): Promise<void> {
    const entry: UsageLedgerEntry = {
      ...stripRecordId(record),
      id: record.recordId ?? randomUUID(),
      recordedAt: new Date().toISOString(),
    };

    const isAppended: boolean = (await this.openStore(workspaceRoot)).append(entry);
    if (!isAppended) {
      return;
    }

    for (const listener of this.listeners) {
      listener();
    }
  }

  public async getSummary(workspaceRoot: StoryUri): Promise<UsageSummaryByEntity> {
    return (await this.openStore(workspaceRoot)).summarize();
  }

  public dispose(): void {
    this.listeners.clear();
  }

  private async openStore(workspaceRoot: StoryUri): Promise<UsageStore> {
    return new UsageStore(await this.dependencies.caches.open(workspaceRoot));
  }
}

function stripRecordId(record: UsageRecord): Omit<UsageRecord, 'recordId'> {
  return {
    taskName: record.taskName,
    providerId: record.providerId,
    model: record.model,
    usage: record.usage,
    costUsd: record.costUsd,
    attribution: record.attribution,
  };
}
