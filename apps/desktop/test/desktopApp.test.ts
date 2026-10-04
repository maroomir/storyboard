import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createWorkspaceRunLockRecord,
  serializeWorkspaceRunLock,
  STORYBOARD_RELATIVE_PATHS,
} from '@storyboard/story-model';
import { resolveStoryboardHomePaths } from '@storyboard/story-config';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DesktopApp } from '@/main/desktopApp';
import { createInvokeHandlers } from '@/main/invokeHandlers';
import { createIpcRouter } from '@/main/ipcRouter';
import type { RunSnapshot } from '@/shared/dto';
import type {
  InvokeChannel,
  InvokeRequest,
  InvokeResponses,
  InvokeResult,
  WorkspaceCreateRequest,
} from '@/shared/ipcContract';

let home: string;
let documents: string;
let app: DesktopApp;
let router: (message: unknown) => Promise<InvokeResult<InvokeChannel>>;
let notices: string[];
let runEvents: RunSnapshot[];

const createRequest: WorkspaceCreateRequest = {
  title: '겨울 항구의 편지',
  genre: '로맨스',
  audience: '20대 독자',
  pov: 'third-limited',
  composition: 'linear',
  chapterCount: 2,
  scenesPerChapter: 2,
  targetWordCount: 12_000,
  concept: '편지 한 통을 두고 서로 다른 겨울을 기억하는 두 사람의 이야기.',
};

async function invoke<C extends InvokeChannel>(channel: C, request: InvokeRequest<C>): Promise<InvokeResult<C>> {
  return (await router({ channel, request })) as InvokeResult<C>;
}

async function expectOk<C extends InvokeChannel>(channel: C, request: InvokeRequest<C>): Promise<InvokeResponses[C]> {
  const result = await invoke(channel, request);
  if (!result.ok) {
    throw new Error(`${channel} failed: ${result.error.code} ${result.error.message}`);
  }
  return result.data;
}

function workspacePath(): string {
  return join(documents, 'Storyboard', createRequest.title);
}

function gitSubjects(): string[] {
  return execFileSync('git', ['log', '--format=%s'], { cwd: workspacePath(), encoding: 'utf8' })
    .trim()
    .split('\n');
}

function writeScene(stem: string, title: string): void {
  mkdirSync(join(workspacePath(), 'scene'), { recursive: true });
  writeFileSync(
    join(workspacePath(), 'scene', `${stem}.card`),
    ['type: scene', `id: ${stem}`, `title: ${title}`, 'characters:', '  - hana', 'summary: 하나가 방파제 끝에서 편지를 다시 읽는다.', ''].join('\n'),
  );
}

function writeDraft(stem: string, body: string): void {
  mkdirSync(join(workspacePath(), 'draft'), { recursive: true });
  writeFileSync(
    join(workspacePath(), 'draft', `${stem}.md`),
    `---\nsceneStem: ${stem}\nformat: novel\ngeneratedAt: '2026-09-27T00:00:00.000Z'\n---\n${body}`,
  );
}

async function waitForIdle(): Promise<RunSnapshot> {
  await app.session?.runs.waitUntilIdle();
  return await expectOk('run.status', {});
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'storyboard-desktop-home-'));
  documents = mkdtempSync(join(tmpdir(), 'storyboard-desktop-docs-'));
  notices = [];
  runEvents = [];
  app = new DesktopApp({
    homePaths: resolveStoryboardHomePaths({ STORYBOARD_HOME: home }),
    logFile: join(home, 'logs', 'desktop.log'),
    version: '0.0.0-test',
    systemLocale: 'ko-KR',
    documentsDirectory: documents,
    chooseDirectory: async () => undefined,
    emit: (event, payload) => {
      if (event === 'run.changed') {
        runEvents.push(payload as RunSnapshot);
      }
    },
    notify: (message) => notices.push(message),
    installUpdate: () => undefined,
  });
  router = createIpcRouter(createInvokeHandlers(app), app.logger, {
    invalidRequest: () => 'invalid',
    internal: (message) => `internal: ${message}`,
  });
});

afterEach(async () => {
  await app.shutdown('now');
  rmSync(home, { recursive: true, force: true });
  rmSync(documents, { recursive: true, force: true });
});

describe('first run', () => {
  it('reports that no AI service is connected yet, in the system language', async () => {
    const bootstrap = await expectOk('app.bootstrap', {});

    expect(bootstrap.isProviderReady).toBe(false);
    expect(bootstrap.language).toBe('ko');
    expect(bootstrap.defaultParentDirectory).toBe(join(documents, 'Storyboard'));
  });

  it('never offers the mock provider to a writer', async () => {
    const settings = await expectOk('settings.read', {});

    expect(settings.providers.map((provider) => provider.id)).not.toContain('mock');
    expect(settings.providers.find((provider) => provider.id === 'ollama')?.isAdvanced).toBe(true);
  });
});

describe('creating a work', () => {
  it('writes the workspace with its contract and records the first version', async () => {
    const overview = await expectOk('workspace.create', {
      parentDirectory: join(documents, 'Storyboard'),
      request: createRequest,
    });

    expect(overview.title).toBe('겨울 항구의 편지');
    expect(overview.missingContractFields).toEqual([]);
    const project = JSON.parse(readFileSync(join(workspacePath(), STORYBOARD_RELATIVE_PATHS.projectJson), 'utf8')) as {
      setting: Record<string, unknown>;
    };
    expect(project.setting).toMatchObject({ genre: '로맨스', pov: 'third-limited', chapterCount: 2, composition: 'linear' });
    expect(gitSubjects()).toEqual(['새 작품: 겨울 항구의 편지']);
    expect((await expectOk('app.bootstrap', {})).recentWorkspaces[0]?.title).toBe('겨울 항구의 편지');
  });

  it('refuses a parent folder that main did not offer', async () => {
    const result = await invoke('workspace.create', { parentDirectory: tmpdir(), request: createRequest });

    expect(result.ok ? undefined : result.error.code).toBe('invalid-request');
  });

  it('refuses to create over an existing folder', async () => {
    mkdirSync(workspacePath(), { recursive: true });

    const result = await invoke('workspace.create', {
      parentDirectory: join(documents, 'Storyboard'),
      request: createRequest,
    });

    expect(result.ok ? undefined : result.error.code).toBe('already-exists');
  });

  it('opens a recent work only when main put it on the list', async () => {
    const result = await invoke('workspace.open', { recentPath: tmpdir() });

    expect(result.ok ? undefined : result.error.code).toBe('invalid-request');
  });
});

describe('with a work open', () => {
  beforeEach(async () => {
    await expectOk('workspace.create', { parentDirectory: join(documents, 'Storyboard'), request: createRequest });
    writeScene('01-harbor', '밤의 방파제');
    writeDraft('01-harbor', '생성된 첫 문단.\n');
  });

  it('rejects a scene id that could leave the workspace', async () => {
    const result = await invoke('draft.read', { stem: '../../etc/passwd' } as never);

    expect(result.ok ? undefined : result.error.code).toBe('invalid-request');
  });

  it('lists the scene in the table of contents with its draft length', async () => {
    const overview = await expectOk('workspace.overview', {});

    expect(overview.chapters.flatMap((chapter) => chapter.scenes)).toMatchObject([
      { stem: '01-harbor', title: '밤의 방파제', status: 'drafted', length: '생성된 첫 문단.'.length },
    ]);
  });

  it('hands the scene card to the desk: the summary file, the beats and the mood', async () => {
    const sceneDirectory = join(workspacePath(), 'scene');
    writeFileSync(
      join(sceneDirectory, '02-letter.card'),
      [
        'type: scene',
        'id: 02-letter',
        'title: 편지',
        'mood: 쓸쓸함',
        'summary: 02-letter.summary.md',
        'beats:',
        '  - 하나가 우체국 앞에서 망설인다.',
        '  - 준이 편지를 대신 부친다.',
        '',
      ].join('\n'),
    );
    writeFileSync(join(sceneDirectory, '02-letter.summary.md'), '하나는 끝내 편지를 부치지 못한다.\n');
    writeFileSync(join(sceneDirectory, '03-quiet.card'), ['type: scene', 'id: 03-quiet', 'title: 고요', ''].join('\n'));

    const withCard = await expectOk('scene.notes', { stem: '02-letter' });
    const bare = await expectOk('scene.notes', { stem: '03-quiet' });

    expect(withCard).toMatchObject({
      summary: '하나는 끝내 편지를 부치지 못한다.',
      beats: ['하나가 우체국 앞에서 망설인다.', '준이 편지를 대신 부친다.'],
      mood: '쓸쓸함',
    });
    expect(bare.beats).toEqual([]);
    expect(bare.summary).toBeUndefined();
    expect(bare.mood).toBeUndefined();
  });

  it('keeps one history copy per editing session and snapshots when the session ends', async () => {
    await expectOk('draft.save', { stem: '01-harbor', body: '고친 문단 하나.\n', reason: 'autosave' });
    await expectOk('draft.save', { stem: '01-harbor', body: '고친 문단 둘.\n', reason: 'autosave' });
    await expectOk('draft.endSession', { stem: '01-harbor' });

    expect(readdirSync(join(workspacePath(), '.draft', '01-harbor'))).toHaveLength(1);
    expect((await expectOk('draft.read', { stem: '01-harbor' })).body).toBe('고친 문단 둘.\n');
    expect(gitSubjects()[0]).toBe('직접 고침: 밤의 방파제');
  });

  it('renames a scene with its draft, snapshots it, and refuses a number another scene holds', async () => {
    writeScene('02-letter', '편지');

    const renamed = await expectOk('scene.rename', { stem: '01-harbor', to: '03-harbor' });
    const taken = await invoke('scene.rename', { stem: '03-harbor', to: '02-harbor' });

    expect(renamed.stem).toBe('03-harbor');
    expect((await expectOk('draft.read', { stem: '03-harbor' })).body).toBe('생성된 첫 문단.\n');
    expect(existsSync(join(workspacePath(), 'draft', '01-harbor.md'))).toBe(false);
    expect(gitSubjects()[0]).toBe('씬 번호·이름 바꿈: 밤의 방파제 (01-harbor → 03-harbor)');
    expect(taken.ok ? undefined : taken.error.code).toBe('already-exists');
  });

  it('refuses to rename while another app holds the work', async () => {
    const record = createWorkspaceRunLockRecord(
      { owner: 'cli', label: 'storyboard novel generate', pid: 1, hostname: 'elsewhere' },
      'cli-token',
      new Date(),
    );
    writeFileSync(join(workspacePath(), STORYBOARD_RELATIVE_PATHS.runLock), serializeWorkspaceRunLock(record));

    const result = await invoke('scene.rename', { stem: '01-harbor', to: '03-harbor' });

    expect(result.ok ? undefined : result.error.code).toBe('workspace-locked');
    expect(existsSync(join(workspacePath(), 'scene', '01-harbor.card'))).toBe(true);
  });

  it('refuses edits while another app holds the work, and says who', async () => {
    const record = createWorkspaceRunLockRecord(
      { owner: 'cli', label: 'storyboard novel generate', pid: 1, hostname: 'elsewhere' },
      'cli-token',
      new Date(),
    );
    writeFileSync(join(workspacePath(), STORYBOARD_RELATIVE_PATHS.runLock), serializeWorkspaceRunLock(record));

    const save = await invoke('draft.save', { stem: '01-harbor', body: '몰래 고침\n', reason: 'autosave' });
    const overview = await expectOk('workspace.overview', {});

    expect(save.ok ? undefined : save.error.code).toBe('workspace-locked');
    expect(overview.foreignLock?.message).toContain('CLI');
  });

  it('refuses to start without a connected AI service', async () => {
    const result = await invoke('run.generateScene', { stem: '01-harbor', force: true });

    expect(result.ok ? undefined : result.error.code).toBe('provider-missing');
  });

  it('saves a card through the story-model schema and rejects an invalid one', async () => {
    await expectOk('bible.create', { kind: 'character', id: 'hana', name: '하나' });
    const card = await expectOk('bible.read', { kind: 'character', id: 'hana' });

    const saved = await expectOk('bible.save', { kind: 'character', card: { ...card, description: ['편지를 받은 사람'] } });
    const invalid = await invoke('bible.save', { kind: 'character', card: { ...card, role: 'villain' } });

    expect(saved).toMatchObject({ name: '하나', description: ['편지를 받은 사람'] });
    expect(invalid.ok ? undefined : invalid.error.code).toBe('invalid-request');
    expect(readFileSync(join(workspacePath(), 'character', 'hana.card'), 'utf8')).toContain('편지를 받은 사람');
    expect(gitSubjects()[0]).toBe('설정집: 하나');
  });

  it('adds and confirms a canon fact', async () => {
    await expectOk('canon.save', {
      fact: { id: 'fact-1', subject: { kind: 'character', id: 'hana' }, key: '편지', value: '하나가 받은 것', status: 'candidate' },
    });
    const facts = await expectOk('canon.save', {
      fact: { id: 'fact-1', subject: { kind: 'character', id: 'hana' }, key: '편지', value: '하나가 받은 것', status: 'canon' },
    });

    expect(facts).toMatchObject([{ id: 'fact-1', status: 'canon' }]);
  });

  it('keeps the run budget in the work, not in every work', async () => {
    await expectOk('run.setBudget', { budgetUsd: 7 });

    const workspaceConfig = JSON.parse(readFileSync(join(workspacePath(), '.storyboard', 'config.json'), 'utf8')) as {
      budget?: { run?: { limitUsd?: number } };
    };
    expect(workspaceConfig.budget?.run?.limitUsd).toBe(7);
    expect(existsSync(join(home, 'config.json'))).toBe(false);
  });

  it('restores an earlier version without losing the current one', async () => {
    await expectOk('draft.save', { stem: '01-harbor', body: '두 번째 버전.\n', reason: 'autosave' });
    await expectOk('draft.endSession', { stem: '01-harbor' });
    const versions = await expectOk('history.list', {});
    const created = versions.find((entry) => entry.message.startsWith('새 작품'));

    await expectOk('history.restore', { id: created?.id ?? '' });

    expect(existsSync(join(workspacePath(), 'draft', '01-harbor.md'))).toBe(false);
    // The edit session was already its own version, so nothing was left to save before the restore.
    expect(gitSubjects().slice(0, 2)).toEqual(['되돌림: 새 작품: 겨울 항구의 편지', '직접 고침: 밤의 방파제']);
  });
});

describe('generating with the mock provider', () => {
  beforeEach(async () => {
    writeFileSync(join(home, 'config.json'), JSON.stringify({ 'ai.provider.default': 'mock', revise: { loop: { afterGenerate: false } } }));
    await expectOk('workspace.create', { parentDirectory: join(documents, 'Storyboard'), request: createRequest });
    await expectOk('bible.create', { kind: 'character', id: 'hana', name: '하나' });
    writeScene('01-harbor', '밤의 방파제');
  });

  it('writes a scene, holds the lock while it runs, and snapshots the result', async () => {
    const started = await expectOk('run.generateScene', { stem: '01-harbor', force: false });
    const lockWhileRunning = existsSync(join(workspacePath(), STORYBOARD_RELATIVE_PATHS.runLock));
    const finished = await waitForIdle();

    expect(started.status).toBe('running');
    expect(lockWhileRunning).toBe(true);
    expect(finished.lastOutcome?.outcome, finished.lastOutcome?.message).toBe('completed');
    expect(existsSync(join(workspacePath(), 'draft', '01-harbor.md'))).toBe(true);
    expect(existsSync(join(workspacePath(), STORYBOARD_RELATIVE_PATHS.runLock))).toBe(false);
    expect(gitSubjects()[0]).toBe('원고 생성: 밤의 방파제');
    expect(runEvents.some((snapshot) => snapshot.log.length > 0)).toBe(true);
  });

  it('refuses a second run while one is active', async () => {
    await expectOk('run.generateScene', { stem: '01-harbor', force: false });
    const second = await invoke('run.generateScene', { stem: '01-harbor', force: true });
    await waitForIdle();

    expect(second.ok ? undefined : second.error.code).toBe('run-active');
  });

  it('refuses hand edits while its own run writes the work', async () => {
    writeDraft('01-harbor', '이전 원고\n');
    await expectOk('run.generateScene', { stem: '01-harbor', force: true });
    const save = await invoke('draft.save', { stem: '01-harbor', body: '끼어든 편집\n', reason: 'autosave' });
    await waitForIdle();

    expect(save.ok ? undefined : save.error.code).toBe('workspace-locked');
  });
});
