import { readFile } from 'node:fs/promises';

import type { CommitHook, GitClient } from '@storyboard/story-git';
import { describeBlocker } from '@storyboard/story-git';

import { atomicWriteFile } from '../util/atomicWrite';
import type { Logger } from '../util/logger';
import type { MutateOutcome, StaleFile, WorkspaceChanges } from './workspaceChanges';
import { hashContent, type WorkspaceStore } from './workspaceStore';

export interface MutateGateOptions {
  // Artifacts the workspace .gitignore excludes (draft/, cache) are written but never committed:
  // committing them would fail anyway and would pollute history.
  readonly isTrackedPath: (relativePath: string) => boolean;
}

// The single place where the bot writes to the workspace. Two invariants live here:
//   1. Freshness — every write re-reads its target immediately before writing and refuses if the
//      bytes no longer match the baseline the edit was derived from. This is what makes it safe for
//      the bot and the VSCode extension to edit the very same directory.
//   2. A successful save of a tracked file is always a commit, scoped to exactly the paths written.
export class MutateGate {
  public constructor(
    private readonly store: WorkspaceStore,
    private readonly git: GitClient,
    private readonly commitHook: CommitHook,
    private readonly logger: Logger,
    private readonly options: MutateGateOptions,
  ) {}

  public async apply(changes: WorkspaceChanges, commitMessage: string): Promise<MutateOutcome> {
    if (changes.writes.length === 0) {
      return { status: 'no-op' };
    }

    const blocker = this.git.findBlocker();
    if (blocker !== undefined) {
      return { status: 'blocked', detail: describeBlocker(blocker) };
    }

    const stale = await this.findStaleFiles(changes);
    if (stale.length > 0) {
      return { status: 'stale', files: stale };
    }

    const changed = await this.writeChangedFiles(changes);
    if (changed.length === 0) {
      return { status: 'no-op' };
    }

    const tracked = changed.filter((relativePath) => this.options.isTrackedPath(relativePath));
    if (tracked.length === 0) {
      return { status: 'written', paths: changed };
    }

    this.commitHook.commitOnWrite(tracked, commitMessage);
    return { status: 'committed', paths: changed };
  }

  // Re-reads every target immediately before the write. Reading here rather than trusting an
  // earlier read is the entire point: a Desktop save between the edit and the write must lose.
  private async findStaleFiles(changes: WorkspaceChanges): Promise<StaleFile[]> {
    const stale: StaleFile[] = [];

    for (const write of changes.writes) {
      const current = await this.tryReadText(write.relativePath);

      if (write.baselineHash === undefined) {
        if (current !== undefined) {
          stale.push({ relativePath: write.relativePath, reason: 'already-exists' });
        }
        continue;
      }

      if (current === undefined) {
        stale.push({ relativePath: write.relativePath, reason: 'deleted-on-disk' });
        continue;
      }

      if (hashContent(current) !== write.baselineHash) {
        stale.push({ relativePath: write.relativePath, reason: 'changed-on-disk' });
      }
    }

    return stale;
  }

  private async writeChangedFiles(changes: WorkspaceChanges): Promise<string[]> {
    const written: string[] = [];

    for (const write of changes.writes) {
      const current = await this.tryReadText(write.relativePath);
      if (current === write.content) {
        continue;
      }

      atomicWriteFile(this.store.absolutePath(write.relativePath), write.content);
      written.push(write.relativePath);
      this.logger.info(`wrote ${write.relativePath}`);
    }

    return written;
  }

  private async tryReadText(relativePath: string): Promise<string | undefined> {
    try {
      return await readFile(this.store.absolutePath(relativePath), 'utf8');
    } catch {
      return undefined;
    }
  }
}

// Generated artifacts live inside the workspace but are gitignored, exactly as the extension
// scaffolds them. Everything else the bot writes is tracked and therefore committed.
export function createDefaultTrackedPathPredicate(): (relativePath: string) => boolean {
  const ignoredPrefixes = ['draft/', '.draft/', 'manuscript/', '.storyboard/cache/'];

  return (relativePath) => !ignoredPrefixes.some((prefix) => relativePath.startsWith(prefix));
}
