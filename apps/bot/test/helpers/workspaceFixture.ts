import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STORYBOARD_RELATIVE_PATHS } from '@storyboard/story-format';

// The round-trip fixtures the extension is also tested against, so both apps prove they read and
// write the exact same bytes.
export const SHARED_FIXTURE_ROOT = fileURLToPath(
  new URL('../../../../packages/story-format/test/fixtures/', import.meta.url),
);

export interface WorkspaceFixture {
  readonly root: string;
  readonly cleanup: () => void;
  readonly write: (relativePath: string, content: string) => void;
  readonly git: (...args: string[]) => string;
}

const DEFAULT_PROJECT = {
  version: '1.0.0',
  name: 'fixture-novel',
  setting: {
    format: 'novel',
    genre: '판타지',
    audience: '성인',
    pov: 'third-limited',
    styleConstraints: [],
    qualityCriteria: [],
  },
};

// Creates a throwaway Storyboard workspace backed by a real git repository. Tests that exercise
// commits need real git behaviour (index locking, rename detection, rebase), so this never stubs it.
export function createWorkspaceFixture(options?: { readonly initGit?: boolean }): WorkspaceFixture {
  const root = mkdtempSync(join(tmpdir(), 'storyboard-bot-ws-'));

  const write = (relativePath: string, content: string): void => {
    const absolute = join(root, ...relativePath.split('/'));
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, 'utf8');
  };

  const git = (...args: string[]): string =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false }).trim();

  for (const directory of [
    STORYBOARD_RELATIVE_PATHS.characterDirectory,
    STORYBOARD_RELATIVE_PATHS.backgroundDirectory,
    STORYBOARD_RELATIVE_PATHS.sceneDirectory,
    STORYBOARD_RELATIVE_PATHS.draftDirectory,
    STORYBOARD_RELATIVE_PATHS.cacheDirectory,
  ]) {
    mkdirSync(join(root, ...directory.split('/')), { recursive: true });
  }

  write(STORYBOARD_RELATIVE_PATHS.projectJson, `${JSON.stringify(DEFAULT_PROJECT, null, 2)}\n`);
  write(
    STORYBOARD_RELATIVE_PATHS.gitignore,
    ['.storyboard/cache/', 'draft/', '.draft/', 'manuscript/', ''].join('\n'),
  );

  if (options?.initGit !== false) {
    git('init', '--quiet', '--initial-branch=main');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.com');
    git('add', '--all');
    git('commit', '--quiet', '-m', 'chore: Initialize fixture workspace');
  }

  return {
    root,
    write,
    git,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function copySharedFixture(
  fixture: WorkspaceFixture,
  kind: 'cards' | 'scenes',
  fixtureName: string,
  relativeTarget: string,
): void {
  const source = join(SHARED_FIXTURE_ROOT, kind, fixtureName);
  const target = join(fixture.root, ...relativeTarget.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
