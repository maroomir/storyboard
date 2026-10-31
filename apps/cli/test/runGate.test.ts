import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RunGate } from '@storyboard/story-app';
import { acquireWorkspaceRunLock, type AcquireWorkspaceRunLockResult } from '@storyboard/story-engine';
import { getStoryboardProjectPaths, NodeUri } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-run-gate-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('RunGate', () => {
  it('holds the workspace while the work runs and releases it afterwards', async () => {
    const fileSystem = new NodeFileSystem();
    const root = NodeUri.file(workspace);
    const gate = new RunGate({ fileSystem, owner: 'cli' });
    const lockUri = getStoryboardProjectPaths(root).runLock;

    const held = await gate.hold(root, 'storyboard novel generate', async () => {
      return await fileSystem.exists(lockUri);
    });

    expect(held).toEqual({ ok: true, value: true });
    expect(await fileSystem.exists(lockUri)).toBe(false);
  });

  it('refuses while another app holds the workspace and names that holder', async () => {
    const fileSystem = new NodeFileSystem();
    const root = NodeUri.file(workspace);
    const cli = new RunGate({ fileSystem, owner: 'cli' });

    const acquired: AcquireWorkspaceRunLockResult = await acquireWorkspaceRunLock({
      fileSystem,
      workspaceRoot: root,
      holder: { owner: 'vscode', label: '장편 생성', pid: 1, hostname: 'elsewhere' },
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
