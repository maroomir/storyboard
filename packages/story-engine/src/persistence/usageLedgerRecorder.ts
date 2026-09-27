import { randomUUID } from 'node:crypto';

import type { UsageRecord, UsageSummaryByEntity } from '@storyboard/story-ai';
import type { StoryUri } from '@storyboard/story-format';

import {
  appendLedgerEntryIfNew,
  computeUsageSummaryFromEntries,
  readUsageLedgerFromUri,
  writeUsageLedgerToUri,
  type UsageLedgerEntry,
  type UsageLedgerFileSystem,
} from '#engine/domain/files/usageLedger';
import { getStoryboardProjectPaths } from '#engine/paths/projectPaths';

interface WorkspaceUsageCache {
  entries: UsageLedgerEntry[];
  summary: UsageSummaryByEntity;
}

// The workspace's cost ledger (`.storyboard/cache/usage.json`). Writes for one workspace are
// serialised so two calls finishing together cannot drop each other's entry.
export class UsageLedgerRecorder {
  private readonly cacheByWorkspaceKey = new Map<string, WorkspaceUsageCache>();
  private readonly chainByWorkspaceKey = new Map<string, Promise<void>>();
  private readonly listeners = new Set<() => void>();

  public constructor(
    private readonly fileSystem: UsageLedgerFileSystem,
    private readonly warn?: (message: string) => void,
  ) {}

  public onChange(listener: () => void): { readonly dispose: () => void } {
    this.listeners.add(listener);
    return { dispose: (): void => void this.listeners.delete(listener) };
  }

  public async record(workspaceRoot: StoryUri, record: UsageRecord): Promise<void> {
    const key = workspaceRoot.fsPath;
    const previous = this.chainByWorkspaceKey.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.recordSerialized(workspaceRoot, record));
    this.chainByWorkspaceKey.set(key, next);

    await next;
  }

  public async getSummary(workspaceRoot: StoryUri): Promise<UsageSummaryByEntity> {
    const cache = await this.ensureLoaded(workspaceRoot);
    return cache.summary;
  }

  protected clearListeners(): void {
    this.listeners.clear();
  }

  private async recordSerialized(workspaceRoot: StoryUri, record: UsageRecord): Promise<void> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const cache = await this.ensureLoaded(workspaceRoot);

    const entry: UsageLedgerEntry = {
      ...stripRecordId(record),
      id: record.recordId ?? randomUUID(),
      recordedAt: new Date().toISOString(),
    };

    const { entries, appended } = appendLedgerEntryIfNew(cache.entries, entry);

    if (!appended) {
      return;
    }

    await this.fileSystem.createDirectory(paths.cacheDirectory);
    await writeUsageLedgerToUri(this.fileSystem, paths.usageLedger, entries);

    cache.entries = entries;
    cache.summary = computeUsageSummaryFromEntries(entries);

    for (const listener of this.listeners) {
      listener();
    }
  }

  private async ensureLoaded(workspaceRoot: StoryUri): Promise<WorkspaceUsageCache> {
    const key = workspaceRoot.fsPath;
    const existing = this.cacheByWorkspaceKey.get(key);

    if (existing) {
      return existing;
    }

    const paths = getStoryboardProjectPaths(workspaceRoot);
    const loaded = await readUsageLedgerFromUri(this.fileSystem, paths.usageLedger, this.warn);
    const cache: WorkspaceUsageCache = {
      entries: [...loaded],
      summary: computeUsageSummaryFromEntries(loaded),
    };

    this.cacheByWorkspaceKey.set(key, cache);
    return cache;
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
