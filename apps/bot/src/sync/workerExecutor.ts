import { Worker } from 'node:worker_threads';

import type { RemoteSyncOutcome } from '@storyboard/story-git';

// Runs runRemoteSync on a worker thread (decision #30): the operation is stateless, so only the
// outcome crosses the thread boundary and SyncService's state machine stays on the main thread.
// A worker failure degrades to an 'error' outcome instead of rejecting, so the periodic scheduler
// can never take the process down.
export function createWorkerRemoteSyncExecutor(
  workerScriptPath: string,
): (workspaceRoot: string, remote: string) => Promise<RemoteSyncOutcome> {
  return (workspaceRoot, remote) =>
    new Promise((resolve) => {
      const settle = (outcome: RemoteSyncOutcome): void => {
        resolve(outcome);
      };

      let worker: Worker;
      try {
        worker = new Worker(workerScriptPath, { workerData: { workspaceRoot, remote } });
      } catch (error) {
        settle(errorOutcome(error));
        return;
      }

      let settled = false;
      const once = (outcome: RemoteSyncOutcome): void => {
        if (!settled) {
          settled = true;
          settle(outcome);
        }
      };

      worker.once('message', (outcome: RemoteSyncOutcome) => once(outcome));
      worker.once('error', (error) => once(errorOutcome(error)));
      worker.once('exit', (code) => {
        if (code !== 0) {
          once(errorOutcome(new Error(`sync worker exited with code ${code}`)));
        }
      });
    });
}

function errorOutcome(error: unknown): RemoteSyncOutcome {
  return {
    state: 'error',
    pushed: false,
    conflicts: [],
    appliedRemote: false,
    detail: error instanceof Error ? error.message : String(error),
  };
}
