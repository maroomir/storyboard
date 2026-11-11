import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectRepository, WorkspaceInitializer, type WorkspaceCaches } from '@storyboard/story-engine';
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

describe('the thread list of a work', () => {
  it('lives in structure.yaml and reads back into the contract', async () => {
    await createInitializer().createWorkspace({
      workspaceRoot: NodeUri.file(directory),
      name: '작품',
      setting: {
        tags: [],
        prohibitions: [],
        styleConstraints: [],
        qualityCriteria: [],
        composition: 'frame',
        threads: { frame: { title: '외화', wraps: ['inner'] }, inner: { title: '내화' } },
      },
    });

    const projectJson = JSON.parse(readFileSync(join(directory, '.storyboard', 'project.json'), 'utf8'));
    const structure = readFileSync(join(directory, '.storyboard', 'structure.yaml'), 'utf8');
    const project = await new ProjectRepository(new NodeFileSystem()).read(
      NodeUri.file(join(directory, '.storyboard', 'project.json')),
    );

    expect(projectJson.setting.threads).toBeUndefined();
    expect(projectJson.setting.composition).toBe('frame');
    expect(structure).toContain('id: frame');
    expect(structure).toContain('wraps:');
    expect(project.setting?.threads).toEqual({
      frame: { title: '외화', wraps: ['inner'] },
      inner: { title: '내화' },
    });
  });

  it('keeps a linear work to the default main thread and no thread list in the contract', async () => {
    await createInitializer().createWorkspace({ workspaceRoot: NodeUri.file(directory), name: '작품' });

    const project = await new ProjectRepository(new NodeFileSystem()).read(
      NodeUri.file(join(directory, '.storyboard', 'project.json')),
    );

    expect(readFileSync(join(directory, '.storyboard', 'structure.yaml'), 'utf8')).toContain('id: main');
    expect(project.setting?.threads).toBeUndefined();
  });
});
