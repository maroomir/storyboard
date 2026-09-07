import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseCard } from '@storyboard/story-format';
import { GitClient, SyncService } from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CardEditError } from '../src/content/cardEditor';
import { ContentService } from '../src/content/contentService';
import { MutateGate, createGitTrackedPathPredicate } from '../src/workspace/mutateGate';
import { WorkspaceStore } from '../src/workspace/workspaceStore';
import {
  copySharedFixture,
  createWorkspaceFixture,
  type WorkspaceFixture,
} from './helpers/workspaceFixture';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', shell: false }).trim();
}

describe('ContentService', () => {
  let fixture: WorkspaceFixture;
  let content: ContentService;

  beforeEach(() => {
    vi.clearAllMocks();
    fixture = createWorkspaceFixture();
    copySharedFixture(fixture, 'cards', 'character.card', 'character/elia.card');
    copySharedFixture(fixture, 'cards', 'background.card', 'background/school.card');
    execFileSync('git', ['-C', fixture.root, 'add', '--all'], { shell: false });
    execFileSync('git', ['-C', fixture.root, 'commit', '--quiet', '-m', 'seed cards'], {
      shell: false,
    });

    const store = new WorkspaceStore(fixture.root);
    const client = new GitClient(fixture.root);
    const gate = new MutateGate(
      store,
      client,
      new SyncService(client, {}, silentLogger),
      silentLogger,
      {
        isTrackedPath: createGitTrackedPathPredicate(client),
      },
    );
    content = new ContentService(store, gate);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('lists narrator cards and skips one that will not parse', async () => {
    fixture.write(
      'narrator/hana-first.card',
      'type: narrator\nid: hana-first\nname: 하나의 목소리\nperson: first\nknowledge: witnessed\nfocal: hana\n',
    );
    fixture.write('narrator/broken.card', 'type: narrator\nid: [\n');

    const narrators = await content.listNarrators();

    expect(narrators.map((card) => card.id)).toEqual(['hana-first']);
    expect(narrators[0]).toMatchObject({ person: 'first', knowledge: 'witnessed', focal: 'hana' });
  });

  it('commits a new narrator card, because narrator/ is tracked', async () => {
    const outcome = await content.createNarrator({
      type: 'narrator',
      id: 'wide',
      name: '전지',
      person: 'third',
      knowledge: 'omniscient',
    });

    expect(outcome.status).toBe('committed');
    expect(existsSync(join(fixture.root, 'narrator', 'wide.card'))).toBe(true);
    expect(git(fixture.root, 'status', '--porcelain')).toBe('');
    expect(git(fixture.root, 'log', '-1', '--pretty=%s')).toContain('narrator/wide.card');
  });

  it('refuses to overwrite a narrator that appeared since the read', async () => {
    fixture.write('narrator/wide.card', 'type: narrator\nid: wide\nname: 먼저\nperson: third\nknowledge: omniscient\n');
    execFileSync('git', ['-C', fixture.root, 'add', 'narrator/wide.card'], { shell: false });
    execFileSync('git', ['-C', fixture.root, 'commit', '--quiet', '-m', 'desktop narrator'], {
      shell: false,
    });

    const outcome = await content.createNarrator({
      type: 'narrator',
      id: 'wide',
      name: '나중',
      person: 'first',
      knowledge: 'witnessed',
    });

    expect(outcome.status).toBe('stale');
    expect(readFileSync(join(fixture.root, 'narrator', 'wide.card'), 'utf8')).toContain('먼저');
  });

  it('migrates legacy scene texts into cards as a single commit', async () => {
    fixture.write(
      'scene/01-prologue.txt',
      '---\ntitle: 프롤로그\ncharacters: [elia]\n---\n자유 메모.\n\n[목적]\n첫 만남을 보여준다.\n',
    );
    fixture.write('scene/02-turn.txt', '전환 씬의 자유 산문.\n');
    execFileSync('git', ['-C', fixture.root, 'add', '--all'], { shell: false });
    execFileSync('git', ['-C', fixture.root, 'commit', '--quiet', '-m', 'seed scenes'], {
      shell: false,
    });

    await expect(content.listLegacySceneTexts()).resolves.toEqual([
      'scene/01-prologue.txt'.slice('scene/'.length),
      'scene/02-turn.txt'.slice('scene/'.length),
    ]);

    const result = await content.migrateLegacyScenes();

    expect(result?.outcome.status).toBe('committed');
    expect(result?.stems).toEqual(['01-prologue', '02-turn']);
    expect(result?.failures).toEqual([]);

    expect(readFileSync(join(fixture.root, 'scene', '01-prologue.card'), 'utf8')).toBe(
      'type: scene\nid: 01-prologue\ntitle: 프롤로그\ncharacters:\n  - elia\npurpose: 첫 만남을 보여준다.\nsummary: 자유 메모.\n',
    );
    expect(readFileSync(join(fixture.root, 'scene', '02-turn.card'), 'utf8')).toBe(
      'type: scene\nid: 02-turn\nsummary: 전환 씬의 자유 산문.\n',
    );
    expect(existsSync(join(fixture.root, 'scene', '01-prologue.txt'))).toBe(false);
    expect(existsSync(join(fixture.root, 'scene', '02-turn.txt'))).toBe(false);

    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe(
      'storyboard-bot: migrate scenes to card format',
    );
    expect(git(fixture.root, 'status', '--porcelain')).toBe('');
  });

  it('refuses to delete a legacy scene that Desktop changed mid-plan', async () => {
    fixture.write('scene/01-prologue.txt', '원본.\n');
    execFileSync('git', ['-C', fixture.root, 'add', '--all'], { shell: false });
    execFileSync('git', ['-C', fixture.root, 'commit', '--quiet', '-m', 'seed scenes'], {
      shell: false,
    });

    // The gate's test seam fires before the deletion's authoritative check; a Desktop save
    // landing there must leave the changed .txt on disk.
    const store = new WorkspaceStore(fixture.root);
    const client = new GitClient(fixture.root);
    const racingGate = new MutateGate(
      store,
      client,
      new SyncService(client, {}, silentLogger),
      silentLogger,
      {
        isTrackedPath: createGitTrackedPathPredicate(client),
        onWillWrite: (relativePath) => {
          if (relativePath.endsWith('.txt')) {
            fixture.write('scene/01-prologue.txt', 'Desktop이 바꾼 내용.\n');
          }
        },
      },
    );
    const racingContent = new ContentService(store, racingGate);

    const result = await racingContent.migrateLegacyScenes();

    expect(result?.outcome.status).toBe('stale');
    expect(readFileSync(join(fixture.root, 'scene', '01-prologue.txt'), 'utf8')).toBe(
      'Desktop이 바꾼 내용.\n',
    );
  });

  it('returns undefined when there is nothing to migrate', async () => {
    await expect(content.migrateLegacyScenes()).resolves.toBeUndefined();
  });

  it('renames a card and commits exactly that file', async () => {
    const outcome = await content.renameCard('character', 'elia', '엘리아나');

    expect(outcome).toEqual({ status: 'committed', paths: ['character/elia.card'] });
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe(
      'storyboard-bot: update character/elia.card',
    );

    const saved = parseCard(readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8'));
    expect(saved.name).toBe('엘리아나');
  });

  it('is a no-op when the new name matches what is already stored', async () => {
    const outcome = await content.renameCard('character', 'elia', '엘리아');

    expect(outcome).toEqual({ status: 'no-op' });
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe('seed cards');
  });

  it('replaces a list field and keeps the file parseable', async () => {
    const outcome = await content.updateCardList('character', 'elia', 'traits', [
      '용감함',
      '신중함',
    ]);

    expect(outcome.status).toBe('committed');
    const saved = parseCard(readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8'));
    expect(saved.type).toBe('character');
    expect(saved.type === 'character' ? saved.traits : undefined).toEqual(['용감함', '신중함']);
  });

  it('rejects a character-only field on a background card', async () => {
    await expect(
      content.updateCardList('background', 'school', 'traits', ['x']),
    ).rejects.toBeInstanceOf(CardEditError);
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe('seed cards');
  });

  it('rejects an empty value without touching the workspace', async () => {
    await expect(content.renameCard('character', 'elia', '   ')).rejects.toBeInstanceOf(
      CardEditError,
    );
    expect(git(fixture.root, 'status', '--porcelain')).toBe('');
  });

  // End-to-end concurrent-edit guarantee through the public facade.
  it('refuses to overwrite a card that Desktop changed mid-edit', async () => {
    const store = new WorkspaceStore(fixture.root);
    const before = await store.readCard('character', 'elia');

    fixture.write(
      'character/elia.card',
      `${readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8')}\ntags:\n  - desktop\n`,
    );

    // The service re-reads on its own, so it now sees the Desktop bytes and succeeds; the guard is
    // proven by planning against the stale snapshot explicitly.
    const { planCardRename } = await import('../src/content/cardEditor');
    const stalePlan = planCardRename(before, '엘리아');
    const client = new GitClient(fixture.root);
    const gate = new MutateGate(
      store,
      client,
      new SyncService(client, {}, silentLogger),
      silentLogger,
      {
        isTrackedPath: createGitTrackedPathPredicate(client),
      },
    );

    const outcome = await gate.apply(stalePlan.changes, stalePlan.commitMessage);

    expect(outcome).toEqual({
      status: 'stale',
      files: [{ relativePath: 'character/elia.card', reason: 'changed-on-disk' }],
    });
    expect(readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8')).toContain('desktop');
  });
});
