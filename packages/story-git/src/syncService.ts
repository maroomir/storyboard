import type { GitClient } from './gitClient';

// `no-remote` is a first-class resting state, not a degraded one: with no remote configured the bot
// still commits every save locally and /sync settles instantly without touching the network.
export type SyncState = 'clean' | 'no-remote' | 'offline' | 'conflict';

export interface SyncReport {
  readonly state: SyncState;
  readonly pushed: boolean;
  readonly conflicts: readonly string[];
}

export interface SyncLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface CommitHook {
  commitOnWrite(relativePaths: readonly string[], message: string): void;
}

export interface SyncServiceOptions {
  readonly remote?: string;
}

// Every content write becomes a commit; fetch/rebase/push and the SyncState live here. A rebase
// conflict always aborts — the bot never resolves a conflict on the user's behalf and never
// force-pushes, so no commit can be lost.
export class SyncService implements CommitHook {
  private state: SyncState;
  private conflicts: string[] = [];
  private requestPush: (() => void) | undefined;
  private onRemoteCommitsApplied: (() => void) | undefined;

  public constructor(
    private readonly git: GitClient,
    private readonly options: SyncServiceOptions,
    private readonly logger: SyncLogger,
    private readonly notify?: (text: string) => void,
  ) {
    this.state = options.remote === undefined ? 'no-remote' : 'clean';
  }

  // Wired after construction to break the SyncService/PushScheduler cycle.
  public setPushRequest(requestPush: () => void): void {
    this.requestPush = requestPush;
  }

  // A rebase can replace the working tree under the bot, so any cached edit baseline must be
  // invalidated when remote commits land.
  public setRemoteCommitsAppliedHook(hook: () => void): void {
    this.onRemoteCommitsApplied = hook;
  }

  public commitOnWrite(relativePaths: readonly string[], message: string): void {
    try {
      const committed = this.git.commit(relativePaths, message);
      if (committed && this.options.remote !== undefined) {
        this.requestPush?.();
      }
    } catch (error) {
      this.logger.error('커밋에 실패했습니다.', error);
    }
  }

  public syncNow(): SyncReport {
    const remote = this.options.remote;

    if (remote === undefined || !this.git.hasRemote(remote)) {
      return this.settle('no-remote', false);
    }

    const branch = this.git.currentBranch();

    try {
      this.git.fetch(remote);
    } catch {
      this.logger.warn('원격 fetch에 실패했습니다(offline).');
      return this.settle('offline', false);
    }

    if (this.git.countBehind(remote, branch) > 0) {
      const rebase = this.git.rebase(remote, branch);
      if (!rebase.ok) {
        this.git.rebaseAbort();
        this.conflicts = rebase.conflicts;
        this.state = 'conflict';
        this.notify?.(conflictMessage(rebase.conflicts));
        return { state: 'conflict', pushed: false, conflicts: rebase.conflicts };
      }
      this.onRemoteCommitsApplied?.();
    }

    let pushed = false;
    if (this.git.countAhead(remote, branch) > 0) {
      try {
        this.git.push(remote, branch);
        pushed = true;
      } catch {
        this.logger.warn('원격 push에 실패했습니다(offline).');
        return this.settle('offline', false);
      }
    }

    return this.settle('clean', pushed);
  }

  public getState(): SyncState {
    return this.state;
  }

  public getConflicts(): readonly string[] {
    return [...this.conflicts];
  }

  private settle(state: Exclude<SyncState, 'conflict'>, pushed: boolean): SyncReport {
    this.state = state;
    this.conflicts = [];
    return { state, pushed, conflicts: [] };
  }
}

function conflictMessage(conflicts: readonly string[]): string {
  return [
    '⚠️ 동기화 충돌이 발생해 원격 변경을 적용하지 못했습니다(로컬 커밋은 보존됨).',
    `충돌 파일: ${conflicts.join(', ') || '(알 수 없음)'}`,
    'Desktop에서 충돌을 해결하고 push한 뒤 다시 /sync 하세요.',
  ].join('\n');
}
