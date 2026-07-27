import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import type { CommitHook, GitClient } from '@storyboard/story-git';
import { describeBlocker } from '@storyboard/story-git';

import { atomicWriteFile } from '../util/atomicWrite';
import type { Logger } from '../util/logger';
import type {
  MutateOutcome,
  StaleFile,
  WorkspaceChanges,
  WorkspaceWrite,
} from './workspaceChanges';
import { hashContent, type WorkspaceStore } from './workspaceStore';

export interface MutateGateOptions {
  // Artifacts the workspace .gitignore excludes (draft/, cache) are written but never committed:
  // committing them would fail anyway and would pollute history.
  readonly isTrackedPath: (relativePath: string) => boolean;
  // NOTE: test seam — fires between the advisory stale pass and each authoritative check+write
  // pair, so the freshness guard's race window can be exercised deterministically.
  readonly onWillWrite?: (relativePath: string) => void | Promise<void>;
}

// The single place where the bot writes to the workspace. Two invariants live here:
//   1. Freshness — every write verifies its baseline synchronously right next to the write (no
//      await between the check and the bytes landing), so a Desktop save racing the bot can lose
//      at most the advisory pass, never the authoritative one.
//   2. A tracked write either commits or reports that it could not — silent success is forbidden.
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

    // Advisory pass: catches stale files up front so a multi-file plan can report every conflict
    // at once without writing anything.
    const stale = await this.findStaleFiles(changes);
    if (stale.length > 0) {
      return { status: 'stale', files: stale };
    }

    const written: string[] = [];
    try {
      for (const write of changes.writes) {
        await this.options.onWillWrite?.(write.relativePath);

        // Authoritative check: read and verify synchronously, then write immediately. There is no
        // await between the verification and the write, so this pair cannot be raced.
        const verdict = this.checkAndWrite(write);
        if (verdict === 'unchanged') {
          continue;
        }
        if (verdict !== 'written') {
          return this.settleAfterPartialWrites(written, commitMessage, {
            status: 'stale',
            files: [{ relativePath: write.relativePath, reason: verdict }],
          });
        }

        written.push(write.relativePath);
        this.logger.info(`wrote ${write.relativePath}`);
      }
    } catch (error) {
      // A mid-plan write failure (ENOSPC, permissions) must not leave earlier tracked writes
      // uncommitted and unreported.
      const detail = error instanceof Error ? error.message : String(error);
      return this.settleAfterPartialWrites(written, commitMessage, {
        status: 'write-failed',
        written,
        detail,
      });
    }

    if (written.length === 0) {
      return { status: 'no-op' };
    }

    return this.commitTracked(written, commitMessage) ?? { status: 'committed', paths: written };
  }

  private checkAndWrite(write: WorkspaceWrite): 'written' | 'unchanged' | StaleFile['reason'] {
    const absolutePath = this.store.absolutePath(write.relativePath);
    const current = tryReadTextSync(absolutePath);

    if (write.baselineHash === undefined) {
      if (current !== undefined) {
        return 'already-exists';
      }
    } else {
      if (current === undefined) {
        return 'deleted-on-disk';
      }
      if (hashContent(current) !== write.baselineHash) {
        return 'changed-on-disk';
      }
    }

    if (current === write.content) {
      return 'unchanged';
    }

    atomicWriteFile(absolutePath, write.content);
    return 'written';
  }

  // When a later write in the plan is refused or fails, the tracked files already written must
  // still be committed so the workspace never holds silent uncommitted bot output; the original
  // refusal is what the caller sees.
  private settleAfterPartialWrites(
    written: readonly string[],
    commitMessage: string,
    refusal: MutateOutcome,
  ): MutateOutcome {
    if (written.length > 0) {
      this.logger.warn(
        `계획 일부만 적용됨(${written.join(', ')}) — 기록된 파일은 커밋을 시도합니다.`,
      );
      this.commitTracked(written, `${commitMessage} (partial)`);
    }
    return refusal;
  }

  private commitTracked(
    written: readonly string[],
    commitMessage: string,
  ): MutateOutcome | undefined {
    const tracked = written.filter((relativePath) => this.options.isTrackedPath(relativePath));
    if (tracked.length === 0) {
      return { status: 'written', paths: [...written] };
    }

    const committed = this.commitHook.commitOnWrite(tracked, commitMessage);
    if (!committed) {
      // The bytes are on disk but history was not updated — surfacing this is what keeps the
      // "save = commit" invariant honest when a hook or a racing git operation rejects the commit.
      return { status: 'commit-failed', paths: [...written] };
    }
    return undefined;
  }

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

  private async tryReadText(relativePath: string): Promise<string | undefined> {
    try {
      return await readFile(this.store.absolutePath(relativePath), 'utf8');
    } catch {
      return undefined;
    }
  }
}

function tryReadTextSync(absolutePath: string): string | undefined {
  try {
    return readFileSync(absolutePath, 'utf8');
  } catch {
    return undefined;
  }
}

// Tracked-ness follows the WORKSPACE's own git rules, not a fixed list: a project that tracks
// draft/ (Desktop's trackDraft) gets its generated drafts committed, while the scaffold default
// (draft/ ignored) keeps them out of history. git check-ignore is the single source of truth.
export function createGitTrackedPathPredicate(git: GitClient): (relativePath: string) => boolean {
  return (relativePath) => !git.isIgnored(relativePath);
}
