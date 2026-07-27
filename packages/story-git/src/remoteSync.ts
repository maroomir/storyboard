import { GitClient } from './gitClient';

// The stateless remote-sync operation. It holds no SyncService state and touches nothing outside
// git, so a host may run it on a worker thread; the caller maps the outcome onto its state machine.
export type RemoteSyncState = 'clean' | 'offline' | 'conflict' | 'dirty' | 'error';

export interface RemoteSyncOutcome {
  readonly state: RemoteSyncState;
  readonly pushed: boolean;
  readonly conflicts: readonly string[];
  // True when a rebase applied remote commits, so cached edit baselines must be invalidated.
  readonly appliedRemote: boolean;
  readonly detail?: string;
}

function settle(
  state: Exclude<RemoteSyncState, 'conflict'>,
  pushed: boolean,
  appliedRemote: boolean,
  detail?: string,
): RemoteSyncOutcome {
  return {
    state,
    pushed,
    conflicts: [],
    appliedRemote,
    ...(detail === undefined ? {} : { detail }),
  };
}

export function runRemoteSync(workspaceRoot: string, remote: string): RemoteSyncOutcome {
  try {
    const git = new GitClient(workspaceRoot);

    if (!git.hasRemote(remote)) {
      return settle('error', false, false, `원격 '${remote}'이 설정되어 있지 않습니다.`);
    }

    // An unborn branch (init without a commit) makes this throw; that is a setup problem to
    // report, never a reason to take the process down.
    const branch = git.currentBranch();
    if (branch === 'HEAD') {
      return settle('error', false, false, 'detached HEAD 상태에서는 동기화할 수 없습니다.');
    }

    try {
      git.fetch(remote);
    } catch {
      return settle('offline', false, false, '원격 fetch에 실패했습니다.');
    }

    // A brand-new remote has no branch yet: there is nothing to rebase onto, and the first push
    // must create the branch instead of silently reporting clean.
    if (!git.remoteBranchExists(remote, branch)) {
      try {
        git.push(remote, branch);
        return settle('clean', true, false);
      } catch (error) {
        return settle('offline', false, false, pushFailureDetail(error));
      }
    }

    let appliedRemote = false;
    if (git.countBehind(remote, branch) > 0) {
      // A rebase refuses to start over uncommitted tracked changes — the normal state while the
      // user edits in Desktop. That is not a conflict; report it as such without touching the tree.
      if (git.hasTrackedChanges()) {
        return settle('dirty', false, false);
      }

      const rebase = git.rebase(remote, branch);
      if (!rebase.ok) {
        git.rebaseAbort();
        if (rebase.conflicts.length === 0) {
          return settle('dirty', false, false);
        }
        return {
          state: 'conflict',
          pushed: false,
          conflicts: rebase.conflicts,
          appliedRemote: false,
        };
      }
      appliedRemote = true;
    }

    let pushed = false;
    if (git.countAhead(remote, branch) > 0) {
      try {
        git.push(remote, branch);
        pushed = true;
      } catch (error) {
        return settle('offline', pushed, appliedRemote, pushFailureDetail(error));
      }
    }

    return settle('clean', pushed, appliedRemote);
  } catch (error) {
    return settle('error', false, false, error instanceof Error ? error.message : String(error));
  }
}

function pushFailureDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split('\n').find((line) => line.trim().length > 0) ?? raw;
  return `원격 push에 실패했습니다: ${firstLine.trim()}`;
}
