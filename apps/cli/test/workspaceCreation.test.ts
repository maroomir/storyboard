import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceInitializer } from '@storyboard/story-engine';
import { NodeUri } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'storyboard-create-'));
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('creating a workspace', () => {
  it('keeps a README the folder already has', async () => {
    writeFileSync(join(directory, 'README.md'), '# 내 메모\n');

    await new WorkspaceInitializer(new NodeFileSystem()).createWorkspace({
      workspaceRoot: NodeUri.file(directory),
      name: '작품',
    });

    expect(readFileSync(join(directory, 'README.md'), 'utf8')).toBe('# 내 메모\n');
    expect(existsSync(join(directory, '.storyboard', 'project.json'))).toBe(true);
  });

  it('writes the workspace README when the folder has none', async () => {
    await new WorkspaceInitializer(new NodeFileSystem()).createWorkspace({
      workspaceRoot: NodeUri.file(directory),
      name: '작품',
    });

    expect(readFileSync(join(directory, 'README.md'), 'utf8')).toContain('작품');
  });
});
