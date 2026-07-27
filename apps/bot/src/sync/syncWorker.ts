import { parentPort, workerData } from 'node:worker_threads';

import { runRemoteSync } from '@storyboard/story-git';

// Worker entry: runs one remote-sync operation and posts the outcome. Network-bound git calls
// execute here so they can never stall the main thread's Telegram polling or progress edits.
// Spawned per sync by createWorkerRemoteSyncExecutor; exits when done.
const { workspaceRoot, remote } = workerData as { workspaceRoot: string; remote: string };

parentPort?.postMessage(runRemoteSync(workspaceRoot, remote));
