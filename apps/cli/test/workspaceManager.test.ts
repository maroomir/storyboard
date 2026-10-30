import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceManager } from '@storyboard/story-app';
import { ConfigBridge } from '@storyboard/story-ai';
import { NodeUri } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

let directory: string;

function createManager(): WorkspaceManager {
  return new WorkspaceManager({
    fileSystem: new NodeFileSystem(),
    configBridge: new ConfigBridge({
      getConfiguration: () => ({ get: <T>(_section: string, defaultValue: T): T => defaultValue }),
    }),
    resourceRoots: [],
  });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'storyboard-workspace-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('WorkspaceManager', () => {
  it('moves legacy memory into place when a work is prepared', async () => {
    mkdirSync(join(directory, '.storyboard', 'cache'), { recursive: true });
    writeFileSync(join(directory, '.storyboard', 'cache', 'storyState.md'), '- [1] 옛 원장\n');

    const report = await createManager().prepare(NodeUri.file(directory));

    expect(readFileSync(join(directory, '.storyboard', 'memory', 'storyState.md'), 'utf8')).toBe(
      '- [1] 옛 원장\n',
    );
    expect(report.problems).toEqual([]);
  });

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
