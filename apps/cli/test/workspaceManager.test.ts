import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RunGate, WorkspaceManager } from '@storyboard/story-app';
import { ConfigBridge } from '@storyboard/story-ai';
import {
  createWorkspaceRunLockRecord,
  NodeUri,
  serializeWorkspaceRunLock,
  STORYBOARD_RELATIVE_PATHS,
} from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

let directory: string;
let warnings: string[];

function createManager(): WorkspaceManager {
  const fileSystem = new NodeFileSystem();

  return new WorkspaceManager({
    fileSystem,
    runGate: new RunGate({ fileSystem, owner: 'cli' }),
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
});

function writeLegacyStoryState(): void {
  mkdirSync(join(directory, '.storyboard', 'cache'), { recursive: true });
  writeFileSync(join(directory, '.storyboard', 'cache', 'storyState.md'), '- [1] 옛 원장\n');
}

function holdRunLockFromAnotherApp(): void {
  const record = createWorkspaceRunLockRecord(
    { owner: 'vscode', label: '소설 생성', pid: 1, hostname: 'elsewhere' },
    'extension-token',
    new Date(),
  );
  writeFileSync(
    join(directory, STORYBOARD_RELATIVE_PATHS.runLock),
    serializeWorkspaceRunLock(record),
  );
}

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

  it('leaves legacy memory in place while another app holds the run lock', async () => {
    writeLegacyStoryState();
    holdRunLockFromAnotherApp();

    const report = await createManager().prepare(NodeUri.file(directory));

    expect(readFileSync(join(directory, '.storyboard', 'cache', 'storyState.md'), 'utf8')).toBe(
      '- [1] 옛 원장\n',
    );
    expect(existsSync(join(directory, STORYBOARD_RELATIVE_PATHS.storyState))).toBe(false);
    expect(report.problems).toEqual([]);
  });

  it('warns and still loads the resources when moving legacy memory fails', async () => {
    mkdirSync(join(directory, '.storyboard', 'cache', 'storyState.md'), { recursive: true });

    const report = await createManager().prepare(NodeUri.file(directory));

    expect(report.problems).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('옛 AI 기억을');
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
