import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GitClient, SyncService } from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobExecutor } from '../src/gen/jobExecutor';
import { JobManager } from '../src/gen/jobManager';
import { JobQueue } from '../src/gen/jobQueue';
import { JobRunControl } from '../src/gen/jobRunControl';
import { JobStateMachine } from '../src/gen/jobStateMachine';
import { SqliteJobStore } from '../src/gen/jobStore';
import { JobWorker } from '../src/gen/jobWorker';
import { PipelineRunner, type IPipeline } from '../src/gen/pipelineRunner';
import { getActiveJobId } from '../src/provider/jobSignalContext';
import { openDatabase, type StorygramDatabase } from '../src/store/db';
import { MutateGate, createGitTrackedPathPredicate } from '../src/workspace/mutateGate';
import { WorkspaceStore, hashContent } from '../src/workspace/workspaceStore';
import { createWorkspaceFixture, type WorkspaceFixture } from './helpers/workspaceFixture';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false }).trim();
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('condition not reached in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

// The freshness guard's authoritative check sits adjacent to the write. This attacks the exact
// window the blind-pass review found: a Desktop save landing AFTER the advisory stale pass.
describe('MutateGate freshness guard under race', () => {
  let fixture: WorkspaceFixture;

  beforeEach(() => {
    vi.clearAllMocks();
    fixture = createWorkspaceFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('refuses a write when Desktop saves between the advisory pass and the write', async () => {
    fixture.write('character/elia.card', 'id: elia\n');
    git(fixture.root, 'add', '--all');
    git(fixture.root, 'commit', '--quiet', '-m', 'seed');

    const store = new WorkspaceStore(fixture.root);
    const client = new GitClient(fixture.root);
    const gate = new MutateGate(
      store,
      client,
      new SyncService(client, {}, silentLogger),
      silentLogger,
      {
        isTrackedPath: createGitTrackedPathPredicate(client),
        // Fires after findStaleFiles approved the plan — the exact TOCTOU window.
        onWillWrite: (relativePath) => {
          if (relativePath === 'character/elia.card') {
            fixture.write('character/elia.card', 'id: elia\nname: DesktopWon\n');
          }
        },
      },
    );

    const outcome = await gate.apply(
      {
        writes: [
          {
            relativePath: 'character/elia.card',
            content: 'id: elia\nname: BotLost\n',
            baselineHash: hashContent('id: elia\n'),
          },
        ],
      },
      'storygram: update character/elia.card',
    );

    expect(outcome).toEqual({
      status: 'stale',
      files: [{ relativePath: 'character/elia.card', reason: 'changed-on-disk' }],
    });
    expect(readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8')).toContain(
      'DesktopWon',
    );
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe('seed');
  });

  it('commits already-written tracked files when a later write in the plan is refused', async () => {
    fixture.write('character/b.card', 'id: b\n');
    git(fixture.root, 'add', '--all');
    git(fixture.root, 'commit', '--quiet', '-m', 'seed');

    const store = new WorkspaceStore(fixture.root);
    const client = new GitClient(fixture.root);
    const gate = new MutateGate(
      store,
      client,
      new SyncService(client, {}, silentLogger),
      silentLogger,
      {
        isTrackedPath: createGitTrackedPathPredicate(client),
        onWillWrite: (relativePath) => {
          // Desktop edits file B while the plan is mid-flight, after file A was written.
          if (relativePath === 'character/b.card') {
            fixture.write('character/b.card', 'id: b\nname: DesktopWon\n');
          }
        },
      },
    );

    const outcome = await gate.apply(
      {
        writes: [
          { relativePath: 'character/a.card', content: 'id: a\n', baselineHash: undefined },
          {
            relativePath: 'character/b.card',
            content: 'id: b\nname: BotLost\n',
            baselineHash: hashContent('id: b\n'),
          },
        ],
      },
      'storygram: update two cards',
    );

    expect(outcome.status).toBe('stale');
    // File A must not be left as silent uncommitted bot output.
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe(
      'storygram: update two cards (partial)',
    );
    expect(git(fixture.root, 'show', '--name-only', '--format=', 'HEAD')).toBe('character/a.card');
    // File B keeps the Desktop content.
    expect(readFileSync(join(fixture.root, 'character', 'b.card'), 'utf8')).toContain('DesktopWon');
  });
});

describe('job worker resilience', () => {
  let dbDir: string;
  let db: StorygramDatabase;

  beforeEach(() => {
    vi.clearAllMocks();
    dbDir = mkdtempSync(join(tmpdir(), 'storygram-worker-'));
    db = openDatabase(join(dbDir, 'state.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it('survives a takeNext failure and keeps processing later jobs', async () => {
    const jobStore = new SqliteJobStore(db);
    const queue = new JobQueue(jobStore);
    const stateMachine = new JobStateMachine();
    const manager = new JobManager({ store: jobStore, queue, stateMachine });

    const succeeded: number[] = [];
    const pipeline: IPipeline = {
      run: async (job) => {
        succeeded.push(job.id);
        return { success: true, resultRef: 'x' };
      },
    };
    const executor = new JobExecutor({
      store: jobStore,
      stateMachine,
      manager,
      pipelineRunner: new PipelineRunner({ store: jobStore, pipeline }),
      logger: silentLogger,
    });

    // First poll throws (transient sqlite hiccup); the loop must log and keep going.
    let failures = 2;
    const originalTakeNext = queue.takeNext.bind(queue);
    vi.spyOn(queue, 'takeNext').mockImplementation((jobClass) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('transient sqlite error');
      }
      return originalTakeNext(jobClass);
    });

    const worker = new JobWorker({
      queue,
      executor,
      jobsConfig: { heavyConcurrency: 1, lightConcurrency: 1 },
      pollIntervalMs: 5,
      logger: silentLogger,
    });
    worker.start();

    manager.enqueue({ kind: 'draft', class: 'heavy', target: { scene: '01-x' }, chatId: 1 });

    await waitFor(() => succeeded.length === 1);
    await worker.stop();

    expect(silentLogger.error).toHaveBeenCalled();
    expect(jobStore.load(1)?.state).toBe('succeeded');
  });

  it('keeps a completed job as succeeded when cancel lands after the write', async () => {
    const jobStore = new SqliteJobStore(db);
    const queue = new JobQueue(jobStore);
    const stateMachine = new JobStateMachine();
    const manager = new JobManager({ store: jobStore, queue, stateMachine });

    const pipeline: IPipeline = {
      run: async (job) => {
        // The draft is already on disk; the user taps ⏹ just before finalize.
        manager.cancel(job.id);
        return { success: true, resultRef: 'draft/01-x.md' };
      },
    };
    const executor = new JobExecutor({
      store: jobStore,
      stateMachine,
      manager,
      pipelineRunner: new PipelineRunner({ store: jobStore, pipeline }),
      logger: silentLogger,
    });

    const jobId = manager.enqueue({
      kind: 'draft',
      class: 'heavy',
      target: { scene: '01-x' },
      chatId: 1,
    });
    const job = jobStore.load(jobId);
    expect(job).toBeDefined();
    if (job) {
      await executor.execute(job);
    }

    const final = jobStore.load(jobId);
    expect(final?.state).toBe('succeeded');
    expect(final?.resultRef).toBe('draft/01-x.md');
  });

  // Usage callbacks fire on a shared AI service; the executor's job context is what attributes
  // each record to the right ledger row.
  it('publishes the running job id so usage records attribute correctly', async () => {
    const jobStore = new SqliteJobStore(db);
    const queue = new JobQueue(jobStore);
    const stateMachine = new JobStateMachine();
    const manager = new JobManager({ store: jobStore, queue, stateMachine });

    const pipeline: IPipeline = {
      run: async () => {
        const jobId = getActiveJobId();
        if (jobId !== undefined) {
          manager.recordUsage({
            jobId,
            taskName: 'sceneDraft',
            providerId: 'mock',
            inputTokens: 11,
            outputTokens: 22,
            costUsd: 0,
          });
        }
        return { success: true };
      },
    };
    const executor = new JobExecutor({
      store: jobStore,
      stateMachine,
      manager,
      pipelineRunner: new PipelineRunner({ store: jobStore, pipeline }),
      jobRunControl: new JobRunControl(),
      logger: silentLogger,
    });

    const jobId = manager.enqueue({
      kind: 'draft',
      class: 'heavy',
      target: { scene: '02-x' },
      chatId: 1,
    });
    const job = jobStore.load(jobId);
    expect(job).toBeDefined();
    if (job) {
      await executor.execute(job);
    }

    expect(jobStore.load(jobId)?.usage).toEqual({ inputTokens: 11, outputTokens: 22, costUsd: 0 });
    expect(manager.getUsageSince(0)).toEqual({ inputTokens: 11, outputTokens: 22, costUsd: 0 });
  });
});
