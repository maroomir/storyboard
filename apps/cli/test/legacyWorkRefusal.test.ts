import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandDispatcher, type DispatchDependencies } from '@/commands/commandDispatcher';
import type { DispatchResult } from '@/commands/dispatchContract';
import { createCliContainer } from '@/container';

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

let home: string;
let workspace: string;
let exportFolder: string;

function deps(): DispatchDependencies {
  return { version: '0.0.0', cwd: workspace, isInteractive: false, createLogger: () => silentLogger };
}

function writeWorkspaceFile(relativePath: string, text: string): void {
  const target: string = join(workspace, relativePath);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, text);
}

function writeProjectJson(version: string): void {
  writeWorkspaceFile(
    '.storyboard/project.json',
    `${JSON.stringify(
      {
        version,
        id: 'legacy-work',
        name: '옛 작품',
        format: 'novel',
        language: 'ko',
        createdAt: '2026-11-05T00:00:00.000Z',
        editor: {},
        setting: { genre: '미스터리', tags: [], prohibitions: [], styleConstraints: [], qualityCriteria: [] },
      },
      null,
      2,
    )}\n`,
  );
}

function writeLegacyWork(version: string): void {
  writeProjectJson(version);
  writeWorkspaceFile(
    'character/hana.card',
    ['type: character', 'id: hana', 'name: 하나', 'role: main', 'traits:', '  - 침착하다', ''].join('\n'),
  );
  writeWorkspaceFile(
    'background/harbor.card',
    ['type: location', 'id: harbor', 'name: 항구', 'description:', '  - 새벽 항구', 'characterIds: []', 'tags: []', ''].join('\n'),
  );
  writeWorkspaceFile(
    'scene/01-dawn.card',
    ['type: scene', 'id: 01-dawn', 'title: 새벽', 'characters:', '  - hana', 'location: harbor', 'summary: 하나가 항구에 닿는다.', ''].join('\n'),
  );
  writeWorkspaceFile('.storyboard/outline/synopsis.md', '# 시놉시스\n\n하나가 항구에 닿는다.\n');
}

function snapshotWorkspace(): ReadonlyMap<string, string> {
  const files: Map<string, string> = new Map();
  const visit = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const path: string = join(directory, name);
      if (statSync(path).isDirectory()) {
        visit(path);
      } else {
        files.set(relative(workspace, path), createHash('sha256').update(readFileSync(path)).digest('hex'));
      }
    }
  };
  visit(workspace);
  return files;
}

async function dispatchCatching(argv: readonly string[]): Promise<{ readonly exitCode: number; readonly text: string }> {
  try {
    const result: DispatchResult = await new CommandDispatcher(deps()).dispatch([...argv]);
    return { exitCode: result.exitCode, text: `${result.stdout}\n${result.stderr}` };
  } catch (error) {
    return { exitCode: 1, text: error instanceof Error ? error.message : String(error) };
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-legacy-home-'));
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-legacy-ws-'));
  exportFolder = join(mkdtempSync(join(tmpdir(), 'storyboard-legacy-out-')), 'notes');
  vi.stubEnv('STORYBOARD_HOME', home);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock' }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
  rmSync(join(exportFolder, '..'), { recursive: true, force: true });
});

const workspaceVerbs: readonly (readonly string[])[] = [
  ['status'],
  ['novel', 'generate', '--yes'],
  ['outline', 'generate', '--yes'],
  ['project', 'set', '--genre', '판타지'],
  ['manuscript', 'assemble'],
  ['state', 'reseal'],
  ['card', 'build'],
  ['scene', 'create', '첫 장면을 쓴다'],
  ['card', 'create', 'character', '민은 항구의 등대지기다', '--name', '민', '--id', 'min'],
  ['scene', 'list'],
  ['card', 'list'],
  ['draft', 'generate', '--all'],
  ['card', 'interview', 'hana'],
  ['card', 'set', 'hana', 'traits', '용감하다'],
  ['init', '--repair'],
];

describe('a 0.15 work', () => {
  it.each(workspaceVerbs)('refuses %s before it writes anything', async (...argv: string[]) => {
    writeLegacyWork('1.0.0');
    const before: ReadonlyMap<string, string> = snapshotWorkspace();

    const outcome = await dispatchCatching(argv);

    expect(outcome.exitCode, outcome.text).toBe(1);
    expect(outcome.text).toContain('이 작품은 0.15 형식입니다');
    expect(snapshotWorkspace()).toEqual(before);
    expect(existsSync(join(workspace, '.storyboard', 'cache'))).toBe(false);
  });

  it('refuses notes export without writing the work or the export folder', async () => {
    writeLegacyWork('1.0.0');
    const before: ReadonlyMap<string, string> = snapshotWorkspace();

    const outcome = await dispatchCatching(['notes', 'export', exportFolder]);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.text).toContain('이 작품은 0.15 형식입니다');
    expect(snapshotWorkspace()).toEqual(before);
    expect(existsSync(exportFolder)).toBe(false);
  });

  it('fails the format check in doctor and leaves the work as it was', async () => {
    writeLegacyWork('1.0.0');
    const before: ReadonlyMap<string, string> = snapshotWorkspace();

    const result: DispatchResult = await new CommandDispatcher(deps()).dispatch(['doctor', '--json']);
    const checks: { status: string; label: string; detail: string }[] = JSON.parse(result.stdout).data.checks;

    expect(result.exitCode).toBe(1);
    expect(checks).toContainEqual(expect.objectContaining({ status: 'fail', label: '작품 형식' }));
    expect(checks.find((check) => check.label === '작품 형식')?.detail).toContain('이 작품은 0.15 형식입니다');
    expect(snapshotWorkspace()).toEqual(before);
    expect(existsSync(join(workspace, '.storyboard', 'cache'))).toBe(false);
  });

  it('refuses a work whose format version it does not know the same way', async () => {
    writeLegacyWork('3.0.0');
    const before: ReadonlyMap<string, string> = snapshotWorkspace();

    const created = await dispatchCatching(['scene', 'create', '첫 장면을 쓴다']);
    const repaired = await dispatchCatching(['init', '--repair']);

    expect(created.exitCode).toBe(1);
    expect(created.text).toContain('형식 버전(3.0.0)을 알 수 없습니다');
    expect(repaired.exitCode).toBe(1);
    expect(repaired.text).toContain('형식 버전(3.0.0)을 알 수 없습니다');
    expect(snapshotWorkspace()).toEqual(before);
    expect(existsSync(join(workspace, '.storyboard', 'cache'))).toBe(false);
  });

  it('refuses studio creation, the verb the extension\'s «+» and studio write through', async () => {
    writeLegacyWork('1.0.0');
    const before: ReadonlyMap<string, string> = snapshotWorkspace();
    const container = createCliContainer({ workspacePath: workspace, logger: silentLogger, canPrompt: false, version: '0.0.0' });

    const created = await container.studio.create({
      workspaceRoot: container.workspaceRoot,
      kind: 'character',
      description: '민은 항구의 등대지기다',
      shouldPropose: false,
    });

    expect(created).toEqual(expect.objectContaining({ ok: false }));
    expect(created.ok ? '' : created.message).toContain('이 작품은 0.15 형식입니다');
    expect(snapshotWorkspace()).toEqual(before);
    expect(existsSync(join(workspace, '.storyboard', 'cache'))).toBe(false);
  });
});
