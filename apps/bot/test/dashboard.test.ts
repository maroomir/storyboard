import { execFileSync } from 'node:child_process';
import { request } from 'node:http';

import { GitClient, SyncService } from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContentService } from '../src/content/contentService';
import { startDashboardServer, type DashboardHandle } from '../src/dashboard/server';
import type { IEnqueueJob } from '../src/gen/jobManager';
import type { JobView } from '../src/gen/types';
import { MutateGate, createGitTrackedPathPredicate } from '../src/workspace/mutateGate';
import { WorkspaceStore } from '../src/workspace/workspaceStore';
import {
  copySharedFixture,
  createWorkspaceFixture,
  type WorkspaceFixture,
} from './helpers/workspaceFixture';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function stubJobs(views: JobView[]): IEnqueueJob {
  return {
    enqueue: () => 1,
    getStatus: () => undefined,
    getRecent: () => views,
    getLog: () => ({ jobId: 0, entries: [] }),
    cancel: () => false,
    getUsageSince: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
  };
}

describe('dashboard server', () => {
  let fixture: WorkspaceFixture;
  let handle: DashboardHandle;

  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = createWorkspaceFixture();
    copySharedFixture(fixture, 'cards', 'character.card', 'character/elia.card');
    fixture.write('scene/01-prologue.card', 'type: scene\nid: 01-prologue\nsummary: scene\n');
    fixture.write('draft/01-prologue.md', 'draft\n');
    execFileSync('git', ['-C', fixture.root, 'add', '--all'], { shell: false });
    execFileSync('git', ['-C', fixture.root, 'commit', '--quiet', '-m', 'seed'], { shell: false });

    const store = new WorkspaceStore(fixture.root);
    const client = new GitClient(fixture.root);
    const sync = new SyncService(client, {}, silentLogger);
    const gate = new MutateGate(store, client, sync, silentLogger, {
      isTrackedPath: createGitTrackedPathPredicate(client),
    });

    handle = await startDashboardServer(0, {
      store,
      content: new ContentService(store, gate),
      sync,
      jobs: stubJobs([
        {
          job: {
            id: 7,
            kind: 'draft',
            class: 'heavy',
            target: { scene: '01-prologue' },
            targetKey: 'scene:01-prologue',
            options: {},
            state: 'succeeded',
            failureReason: null,
            provider: {},
            chatId: 1,
            progressMessageId: null,
            usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
            resultRef: 'draft/01-prologue.md',
            createdAt: 0,
            startedAt: 0,
            finishedAt: 1,
          },
        },
      ]),
      logger: silentLogger,
    });
  });

  afterEach(async () => {
    await handle.stop();
    fixture.cleanup();
  });

  it('serves the workspace view over loopback', async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/api/workspace`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body['name']).toBe('fixture-novel');
    expect(body['cards']).toBe(1);
    expect(body['scenes']).toBe(1);
    expect(body['drafts']).toBe(1);
    expect(body['syncState']).toBe('no-remote');
    expect(String(body['lastCommit'])).toContain('seed');
  });

  it('lists recent jobs', async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/api/jobs`);
    const body = (await response.json()) as { jobs: Array<Record<string, unknown>> };

    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0]?.['id']).toBe(7);
    expect(body.jobs[0]?.['state']).toBe('succeeded');
  });

  it('serves the panel page', async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('storyboard-bot 운영 패널');
  });

  // SECURITY: DNS rebinding sends a foreign Host header over a loopback connection. fetch() drops
  // a caller-set Host header, so this drives node:http directly.
  it('rejects a foreign Host header even over loopback', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: handle.port,
          path: '/api/workspace',
          headers: { host: 'evil.example.com' },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(status).toBe(403);
  });

  it('rejects mutating methods', async () => {
    const response = await fetch(`http://127.0.0.1:${handle.port}/api/workspace`, {
      method: 'POST',
    });

    expect(response.status).toBe(405);
  });
});
