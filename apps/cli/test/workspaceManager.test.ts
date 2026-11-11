import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RunGate, WorkspaceManager } from '@storyboard/story-app';
import { ConfigBridge } from '@storyboard/story-ai';
import type { WorkspaceCaches } from '@storyboard/story-engine';
import { NodeUri } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

import { createWorkspaceCaches, createWorkspaceRunLocks } from './fixtures/workspaceCacheFixture';

let directory: string;
let warnings: string[];
let caches: WorkspaceCaches;

function createManager(): WorkspaceManager {
  const fileSystem = new NodeFileSystem();

  return new WorkspaceManager({
    fileSystem,
    runGate: new RunGate({ runLocks: createWorkspaceRunLocks(caches), owner: 'cli' }),
    logger: {
      info: () => undefined,
      warn: (message: string) => warnings.push(message),
      error: () => undefined,
      show: () => undefined,
    },
    configBridge: new ConfigBridge({
      getConfiguration: () => ({ get: <T>(_section: string, defaultValue: T): T => defaultValue }),
    }),
    resourceRoots: [],
  });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'storyboard-workspace-'));
  warnings = [];
  caches = createWorkspaceCaches();
});

afterEach(async () => {
  await caches.closeAll();
  rmSync(directory, { recursive: true, force: true });
});

describe('WorkspaceManager', () => {
  it('repairs the layout without sealing when project.json cannot be read', async () => {
    mkdirSync(join(directory, '.storyboard'), { recursive: true });
    writeFileSync(join(directory, '.storyboard', 'project.json'), '{ broken');

    const repaired = await createManager().repair(NodeUri.file(directory));

    expect(repaired.sealedSceneOrders).toEqual([]);
    expect(repaired.addedAgentGuides.length).toBeGreaterThan(0);
    expect(existsSync(join(directory, 'scene'))).toBe(true);
    expect(existsSync(join(directory, '.gitignore'))).toBe(true);
  });
});
