import type { GitClient } from './gitClient';
import { runRemoteSync, type RemoteSyncOutcome } from './remoteSync';

// `no-remote` is a first-class resting state, not a degraded one: with no remote configured the bot
// still commits every save locally and /sync settles instantly without touching the network.
// `dirty` means the user has uncommitted tracked changes (normal while editing in Desktop) that
// block a rebase; `error` covers setup problems such as an unborn branch or detached HEAD.
export type SyncState = 'clean' | 'no-remote' | 'offline' | 'conflict' | 'dirty' | 'error';

export interface SyncReport {
  readonly state: SyncState;
  readonly pushed: boolean;
  readonly conflicts: readonly string[];
  readonly detail?: string;
}

export interface SyncLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface CommitHook {
  // Returns whether the commit actually landed; a swallowed failure here would silently break the
  // "a successful save is always a commit" invariant.
  commitOnWrite(relativePaths: readonly string[], message: string): boolean;
}

export interface SyncServiceOptions {
  readonly remote?: string;
  // Runs the remote-sync operation. The default executes inline; a host may substitute a worker
  // thread so network-bound git calls never block its event loop.
  readonly executeRemoteSync?: (
    workspaceRoot: string,
    remote: string,
  ) => Promise<RemoteSyncOutcome>;
}

// Every content write becomes a commit; fetch/rebase/push and the SyncState live here. A rebase
// conflict always aborts — the bot never resolves a conflict on the user's behalf and never
// force-pushes, so no commit can be lost.
export class SyncService implements CommitHook {
  private state: SyncState;
  private conflicts: string[] = [];
  private requestPush: (() => void) | undefined;
  private onRemoteCommitsApplied: (() => void) | undefined;
  private readonly executeRemoteSync: (
    workspaceRoot: string,
    remote: string,
  ) => Promise<RemoteSyncOutcome>;

  public constructor(
    private readonly git: GitClient,
    private readonly options: SyncServiceOptions,
    private readonly logger: SyncLogger,
    private readonly notify?: (text: string) => void,
  ) {
    this.state = options.remote === undefined ? 'no-remote' : 'clean';
    this.executeRemoteSync =
      options.executeRemoteSync ?? ((root, remote) => Promise.resolve(runRemoteSync(root, remote)));
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

  public commitOnWrite(relativePaths: readonly string[], message: string): boolean {
    try {
      const committed = this.git.commit(relativePaths, message);
      if (committed && this.options.remote !== undefined) {
        this.requestPush?.();
      }
      return true;
    } catch (error) {
      this.logger.error('커밋에 실패했습니다.', error);
      return false;
    }
  }

  public async syncNow(): Promise<SyncReport> {
    const remote = this.options.remote;

    if (remote === undefined) {
      return this.settle({ state: 'no-remote', pushed: false });
    }

    const outcome = await this.executeRemoteSync(this.git.root, remote);

    if (outcome.appliedRemote) {
      this.onRemoteCommitsApplied?.();
    }

    if (outcome.state === 'conflict') {
      this.conflicts = [...outcome.conflicts];
      this.state = 'conflict';
      this.notify?.(conflictMessage(outcome.conflicts));
      return { state: 'conflict', pushed: false, conflicts: outcome.conflicts };
    }

    if (outcome.state === 'offline') {
      this.logger.warn(outcome.detail ?? '원격에 연결할 수 없습니다(offline).');
    }
    if (outcome.state === 'error') {
      this.logger.warn(`동기화 실패: ${outcome.detail ?? '원인 미상'}`);
    }

    return this.settle({
      state: outcome.state,
      pushed: outcome.pushed,
      ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
    });
  }

  public getState(): SyncState {
    return this.state;
  }

  public getConflicts(): readonly string[] {
    return [...this.conflicts];
  }

  private settle(report: {
    readonly state: Exclude<SyncState, 'conflict'>;
    readonly pushed: boolean;
    readonly detail?: string;
  }): SyncReport {
    this.state = report.state;
    this.conflicts = [];
    return { ...report, conflicts: [] };
  }
}

function conflictMessage(conflicts: readonly string[]): string {
  return [
    '⚠️ 동기화 충돌이 발생해 원격 변경을 적용하지 못했습니다(로컬 커밋은 보존됨).',
    `충돌 파일: ${conflicts.join(', ') || '(알 수 없음)'}`,
    'Desktop에서 충돌을 해결하고 push한 뒤 다시 /sync 하세요.',
  ].join('\n');
}
