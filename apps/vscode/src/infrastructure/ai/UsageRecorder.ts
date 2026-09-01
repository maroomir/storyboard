import type { StoryUri } from '@storyboard/story-engine';
import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { getStoryboardProjectPaths } from '@storyboard/story-engine';
import { uriExists } from '../vscode/workspace';
import {
  appendLedgerEntryIfNew,
  computeUsageSummaryFromEntries,
  readUsageLedgerFromUri,
  type UsageLedgerEntry,
  type UsageLedgerFileSystem,
  writeUsageLedgerToUri,
} from '@storyboard/story-engine';
import type { UsageRecord, UsageSummaryByEntity } from '@storyboard/story-ai';

interface WorkspaceUsageCache {
  entries: UsageLedgerEntry[];
  summary: UsageSummaryByEntity;
}

export class UsageRecorder implements vscode.Disposable {
  private readonly cacheByWorkspaceKey = new Map<string, WorkspaceUsageCache>();
  private chainByWorkspaceKey = new Map<string, Promise<void>>();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onChange = this._onDidChange.event;

  public constructor(
    private readonly fileSystem: UsageLedgerFileSystem,
    private readonly warn?: (message: string) => void,
  ) {}

  public dispose(): void {
    this._onDidChange.dispose();
  }

  public async record(workspaceRoot: vscode.Uri, record: UsageRecord): Promise<void> {
    const key = workspaceRoot.fsPath;
    const previous = this.chainByWorkspaceKey.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.recordSerialized(workspaceRoot, record));
    this.chainByWorkspaceKey.set(key, next);

    await next;
  }

  public async getSummary(workspaceRoot: vscode.Uri): Promise<UsageSummaryByEntity> {
    const cache = await this.ensureLoaded(workspaceRoot);
    return cache.summary;
  }

  private async recordSerialized(workspaceRoot: vscode.Uri, record: UsageRecord): Promise<void> {
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

    await this.ensureCacheDirectory(paths.cacheDirectory);
    await writeUsageLedgerToUri(this.fileSystem, paths.usageLedger, entries);

    cache.entries = entries;
    cache.summary = computeUsageSummaryFromEntries(entries);
    this._onDidChange.fire();
  }

  private async ensureLoaded(workspaceRoot: vscode.Uri): Promise<WorkspaceUsageCache> {
    const key = workspaceRoot.fsPath;
    const existing = this.cacheByWorkspaceKey.get(key);

    if (existing) {
      return existing;
    }

    const paths = getStoryboardProjectPaths(workspaceRoot);
    const loaded = await readUsageLedgerFromUri(this.fileSystem, paths.usageLedger, this.warn);
    const summary = computeUsageSummaryFromEntries(loaded);
    const cache: WorkspaceUsageCache = {
      entries: [...loaded],
      summary,
    };

    this.cacheByWorkspaceKey.set(key, cache);
    return cache;
  }

  private async ensureCacheDirectory(cacheDirectory: vscode.Uri): Promise<void> {
    if (await uriExists(cacheDirectory)) {
      return;
    }

    await this.fileSystem.createDirectory(cacheDirectory);
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

export function createVscodeUsageLedgerFileSystem(): UsageLedgerFileSystem {
  return {
    readFile: (uri: StoryUri) => Promise.resolve(vscode.workspace.fs.readFile(uri as vscode.Uri)),
    writeFile: (uri: StoryUri, content: Uint8Array) =>
      Promise.resolve(vscode.workspace.fs.writeFile(uri as vscode.Uri, content)),
    createDirectory: (uri: StoryUri) =>
      Promise.resolve(vscode.workspace.fs.createDirectory(uri as vscode.Uri)),
  };
}
