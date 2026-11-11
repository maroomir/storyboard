import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceInitializer, type WorkspaceCaches } from '@storyboard/story-engine';
import { NodeUri } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

import { createWorkspaceCaches, createWorkspaceCards } from './fixtures/workspaceCacheFixture';

let directory: string;
let caches: WorkspaceCaches;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'storyboard-create-'));
  caches = createWorkspaceCaches();
});

afterEach(async () => {
  await caches.closeAll();
  rmSync(directory, { recursive: true, force: true });
});

function createInitializer(): WorkspaceInitializer {
  return new WorkspaceInitializer(new NodeFileSystem(), createWorkspaceCards(caches));
}

describe('creating a workspace', () => {
  it('keeps a README the folder already has', async () => {
    writeFileSync(join(directory, 'README.md'), '# 내 메모\n');

    await createInitializer().createWorkspace({
      workspaceRoot: NodeUri.file(directory),
      name: '작품',
    });

    expect(readFileSync(join(directory, 'README.md'), 'utf8')).toBe('# 내 메모\n');
    expect(existsSync(join(directory, '.storyboard', 'project.json'))).toBe(true);
  });

  it('writes the workspace README when the folder has none', async () => {
    await createInitializer().createWorkspace({
      workspaceRoot: NodeUri.file(directory),
      name: '작품',
    });

    expect(readFileSync(join(directory, 'README.md'), 'utf8')).toContain('작품');
  });
});
