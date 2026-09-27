import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { locateSnapshotRepository, SnapshotService } from '@/main/snapshotService';

let workspace: string;

function write(relativePath: string, content: string): void {
  const absolute = join(workspace, relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content);
}

function gitLog(cwd: string): string[] {
  return execFileSync('git', ['log', '--format=%s'], { cwd, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((line) => line.length > 0);
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-snapshot-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('SnapshotService', () => {
  it('creates a repository and records the workspace, readable by plain git', async () => {
    write('draft/01-harbor.md', '첫 문단');
    write('.gitignore', '.storyboard/cache/\n');
    write('.storyboard/cache/usage.json', '{}');

    const service = new SnapshotService(await locateSnapshotRepository(workspace));
    const id = await service.snapshot('새 작품: 겨울 항구');

    expect(id).toMatch(/^[0-9a-f]{40}$/);
    expect(gitLog(workspace)).toEqual(['새 작품: 겨울 항구']);
    const tracked = execFileSync('git', ['ls-files'], { cwd: workspace, encoding: 'utf8' });
    expect(tracked).toContain('draft/01-harbor.md');
    expect(tracked).not.toContain('usage.json');
  });

  it('skips a snapshot when nothing changed', async () => {
    write('draft/01-harbor.md', '첫 문단');
    const service = new SnapshotService(await locateSnapshotRepository(workspace));

    await service.snapshot('첫 저장');

    expect(await service.snapshot('같은 내용')).toBeUndefined();
    expect(gitLog(workspace)).toHaveLength(1);
  });

  it('records deletions as well as edits', async () => {
    write('draft/01-harbor.md', '첫 문단');
    write('draft/02-storm.md', '폭풍');
    const service = new SnapshotService(await locateSnapshotRepository(workspace));
    await service.snapshot('두 씬');

    rmSync(join(workspace, 'draft/02-storm.md'));
    write('draft/01-harbor.md', '고친 문단');
    await service.snapshot('하나 지우고 하나 고침');

    const tracked = execFileSync('git', ['ls-files'], { cwd: workspace, encoding: 'utf8' });
    expect(tracked).not.toContain('02-storm.md');
    expect(execFileSync('git', ['show', 'HEAD:draft/01-harbor.md'], { cwd: workspace, encoding: 'utf8' })).toBe(
      '고친 문단',
    );
  });

  it('restores an earlier snapshot as a new one, keeping what it replaced', async () => {
    write('draft/01-harbor.md', '처음 버전');
    const service = new SnapshotService(await locateSnapshotRepository(workspace));
    const first = await service.snapshot('처음');

    write('draft/01-harbor.md', '나중 버전');
    write('draft/02-storm.md', '새 씬');
    await service.snapshot('나중');
    write('draft/01-harbor.md', '저장 안 한 편집');

    await service.restore(first ?? '', '되돌림: 처음');

    expect(readFileSync(join(workspace, 'draft/01-harbor.md'), 'utf8')).toBe('처음 버전');
    expect(existsSync(join(workspace, 'draft/02-storm.md'))).toBe(false);
    expect(gitLog(workspace)).toEqual(['되돌림: 처음', '되돌리기 전 자동 저장', '나중', '처음']);
    expect(
      execFileSync('git', ['show', 'HEAD~1:draft/01-harbor.md'], { cwd: workspace, encoding: 'utf8' }),
    ).toBe('저장 안 한 편집');
  });

  it('commits only the workspace when it sits inside a larger repository', async () => {
    const outer = workspace;
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: outer });
    writeFileSync(join(outer, 'unrelated.txt'), '남의 파일');
    const inner = join(outer, 'novels', 'harbor');
    mkdirSync(join(inner, 'draft'), { recursive: true });
    writeFileSync(join(inner, 'draft', '01-harbor.md'), '첫 문단');

    const location = await locateSnapshotRepository(inner);
    await new SnapshotService(location).snapshot('작품만');

    expect(location.workspacePrefix).toBe('novels/harbor');
    const tracked = execFileSync('git', ['ls-files'], { cwd: outer, encoding: 'utf8' });
    expect(tracked).toContain('novels/harbor/draft/01-harbor.md');
    expect(tracked).not.toContain('unrelated.txt');
  });

  it('lists snapshots newest first', async () => {
    write('a.md', '1');
    const service = new SnapshotService(await locateSnapshotRepository(workspace));
    await service.snapshot('하나');
    write('a.md', '2');
    await service.snapshot('둘');

    expect((await service.list()).map((entry) => entry.message)).toEqual(['둘', '하나']);
  });

  it('shows only the subject of a commit made outside the app', async () => {
    write('a.md', '1');
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: workspace });
    execFileSync('git', ['add', '.'], { cwd: workspace });
    execFileSync(
      'git',
      ['-c', 'user.name=작가', '-c', 'user.email=writer@example.com', 'commit', '-q', '-m', 'feat: 원고 추가\n\n[Problem] 긴 본문\nSigned-off-by: 작가'],
      { cwd: workspace },
    );

    const service = new SnapshotService(await locateSnapshotRepository(workspace));

    expect((await service.list())[0]?.message).toBe('feat: 원고 추가');
  });
});
