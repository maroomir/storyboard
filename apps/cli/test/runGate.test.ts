import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RunGate } from '@storyboard/story-app';
import type { AcquireWorkspaceRunLockResult, WorkspaceCaches } from '@storyboard/story-engine';
import { NodeUri } from '@storyboard/story-model';

import {
  createWorkspaceCaches,
  createWorkspaceRunLocks,
  readRunLockToken,
} from './fixtures/runLockFixture';

let workspace: string;
let caches: WorkspaceCaches;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-run-gate-'));
  caches = createWorkspaceCaches();
});

afterEach(async () => {
  await caches.closeAll();
  rmSync(workspace, { recursive: true, force: true });
});

describe('RunGate', () => {
  it('holds the workspace while the work runs and releases it afterwards', async () => {
    const root = NodeUri.file(workspace);
    const gate = new RunGate({ runLocks: createWorkspaceRunLocks(caches), owner: 'cli' });

    const held = await gate.hold(root, 'storyboard novel generate', async () => {
      return await readRunLockToken(caches, workspace);
    });

    expect(held.ok && typeof held.value === 'string').toBe(true);
    expect(await readRunLockToken(caches, workspace)).toBeUndefined();
  });

  it('refuses while another app holds the workspace and names that holder', async () => {
    const root = NodeUri.file(workspace);
    const runLocks = createWorkspaceRunLocks(caches);
    const cli = new RunGate({ runLocks, owner: 'cli' });

    const acquired: AcquireWorkspaceRunLockResult = await runLocks.acquire(root, {
      owner: 'vscode',
      label: '장편 생성',
      pid: 1,
      hostname: 'elsewhere',
    });
    expect(acquired.ok).toBe(true);

    const held = await cli.hold(root, 'storyboard draft generate', async () => 'ran');

    expect(held.ok).toBe(false);
    if (!held.ok) {
      expect(held.heldBy.owner).toBe('vscode');
      expect(held.message).toContain('장편 생성');
    }

    if (acquired.ok) {
      await acquired.lock.release();
    }
  });
});
