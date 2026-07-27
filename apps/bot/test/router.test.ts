import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseCard } from '@storyboard/story-format';
import { GitClient, SyncService } from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatContext } from '../src/chat/context';
import { createDoctorHandler } from '../src/chat/handlers/doctor';
import { createRenameHandler, createSetHandler } from '../src/chat/handlers/edit';
import {
  createBibleHandler,
  createCardsHandler,
  createScenesHandler,
  createShowHandler,
  createStatusHandler,
  createSyncHandler,
} from '../src/chat/handlers/read';
import type { IncomingUpdate, MessageView, SentMessageRef } from '../src/chat/ports';
import { CommandRegistry } from '../src/chat/registry';
import { UpdateRouter } from '../src/chat/router';
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

function message(text: string): IncomingUpdate {
  return { kind: 'message', chatId: 1, userId: 1, messageId: 1, text };
}

describe('UpdateRouter', () => {
  let fixture: WorkspaceFixture;
  let router: UpdateRouter;
  let sent: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    sent = [];
    fixture = createWorkspaceFixture();
    copySharedFixture(fixture, 'cards', 'character.card', 'character/elia.card');
    copySharedFixture(fixture, 'cards', 'background.card', 'background/school.card');
    fixture.write('scene/01-prologue.txt', 'prologue\n');
    git(fixture.root, 'add', '--all');
    git(fixture.root, 'commit', '--quiet', '-m', 'seed content');

    const store = new WorkspaceStore(fixture.root);
    const client = new GitClient(fixture.root);
    const sync = new SyncService(client, {}, silentLogger);
    const gate = new MutateGate(store, client, sync, silentLogger, {
      isTrackedPath: createGitTrackedPathPredicate(client),
    });
    const content = new ContentService(store, gate);

    const sender = {
      sendMessage: async (_chatId: number, view: MessageView): Promise<SentMessageRef> => {
        sent.push(view.text);
        return { chatId: 1, messageId: sent.length };
      },
      editMessage: async (ref: SentMessageRef): Promise<SentMessageRef> => ref,
      answerCallback: async (): Promise<void> => undefined,
      sendDocument: async (): Promise<SentMessageRef> => ({ chatId: 1, messageId: 0 }),
    };

    const registry = new CommandRegistry();
    for (const handler of [
      createStatusHandler(),
      createCardsHandler(),
      createShowHandler(),
      createScenesHandler(),
      createBibleHandler(),
      createSyncHandler(),
      createRenameHandler(),
      createSetHandler(),
    ]) {
      registry.register(handler);
    }

    router = new UpdateRouter({
      sender,
      registry,
      buildContext: (update) => new ChatContext(update, sender, content, store, sync),
      logger: silentLogger,
    });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('lists cards grouped by kind', async () => {
    await router.handleUpdate(message('/cards'));

    expect(sent[0]).toContain('캐릭터 (1)');
    expect(sent[0]).toContain('elia');
    expect(sent[0]).toContain('배경 (1)');
    expect(sent[0]).toContain('school');
  });

  it('shows a card and its file path', async () => {
    await router.handleUpdate(message('/show elia'));

    expect(sent[0]).toContain('character/elia.card');
  });

  it('reports an unknown card instead of throwing', async () => {
    await router.handleUpdate(message('/show nope'));

    expect(sent[0]).toContain('찾을 수 없습니다');
  });

  it('lists scenes and marks which have drafts', async () => {
    const sceneLine = (text: string): string =>
      text.split('\n').find((line) => line.includes('prologue')) ?? '';

    await router.handleUpdate(message('/scenes'));
    expect(sceneLine(sent[0] ?? '')).toBe('  01 prologue');

    fixture.write('draft/01-prologue.md', '# draft\n');
    await router.handleUpdate(message('/scenes'));
    expect(sceneLine(sent[1] ?? '')).toBe('  01 prologue ✅');
  });

  it('says the bible is absent rather than failing', async () => {
    await router.handleUpdate(message('/bible'));

    expect(sent[0]).toContain('스토리 바이블이 없습니다');
  });

  it('settles /sync as no-remote', async () => {
    await router.handleUpdate(message('/sync'));

    expect(sent[0]).toContain('원격이 설정되어 있지 않습니다');
  });

  // The end-to-end edit path: a chat command becomes a validated file write and a scoped commit.
  it('renames a card through chat and commits it', async () => {
    await router.handleUpdate(message('/rename elia 엘리아나'));

    expect(sent[0]).toContain('저장하고 커밋했습니다');
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe(
      'storygram: update character/elia.card',
    );
    const saved = parseCard(readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8'));
    expect(saved.name).toBe('엘리아나');
  });

  it('sets a list field through chat', async () => {
    await router.handleUpdate(message('/set elia traits 용감함 | 신중함'));

    expect(sent[0]).toContain('저장하고 커밋했습니다');
    const saved = parseCard(readFileSync(join(fixture.root, 'character', 'elia.card'), 'utf8'));
    expect(saved.type === 'character' ? saved.traits : undefined).toEqual(['용감함', '신중함']);
  });

  it('refuses a character-only field on a background card with a readable message', async () => {
    await router.handleUpdate(message('/set school traits 용감함'));

    expect(sent[0]).toContain('캐릭터 카드에만');
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe('seed content');
  });

  it('reports usage for a malformed edit command', async () => {
    await router.handleUpdate(message('/rename elia'));

    expect(sent[0]).toContain('사용법');
  });

  it('guides the user on an unknown command', async () => {
    await router.handleUpdate(message('/nope'));

    expect(sent[0]).toContain('알 수 없는 명령');
  });

  it('guides the user on free text', async () => {
    await router.handleUpdate(message('안녕하세요'));

    expect(sent[0]).toContain('/start');
  });

  it('refuses an edit while another git operation holds the index', async () => {
    fixture.write('.git/index.lock', '');

    await router.handleUpdate(message('/rename elia 엘리아나'));

    expect(sent[0]).toContain('지금은 저장할 수 없습니다');
  });
});

describe('/doctor', () => {
  let fixture: WorkspaceFixture;
  let router: UpdateRouter;
  let sent: string[];

  function build(root: string): void {
    const store = new WorkspaceStore(root);
    const client = new GitClient(root);
    const sync = new SyncService(client, {}, silentLogger);
    const gate = new MutateGate(store, client, sync, silentLogger, {
      isTrackedPath: createGitTrackedPathPredicate(client),
    });
    const content = new ContentService(store, gate);
    const sender = {
      sendMessage: async (_c: number, view: MessageView): Promise<SentMessageRef> => {
        sent.push(view.text);
        return { chatId: 1, messageId: sent.length };
      },
      editMessage: async (ref: SentMessageRef): Promise<SentMessageRef> => ref,
      answerCallback: async (): Promise<void> => undefined,
      sendDocument: async (): Promise<SentMessageRef> => ({ chatId: 1, messageId: 0 }),
    };
    const registry = new CommandRegistry();
    registry.register(createDoctorHandler());
    router = new UpdateRouter({
      sender,
      registry,
      buildContext: (update) => new ChatContext(update, sender, content, store, sync),
      logger: silentLogger,
    });
  }

  beforeEach(() => {
    sent = [];
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('reports a healthy workspace', async () => {
    fixture = createWorkspaceFixture();
    build(fixture.root);

    await router.handleUpdate(message('/doctor'));

    expect(sent[0]).toContain('✅ git: 커밋 가능');
    expect(sent[0]).toContain('✅ 동기화 상태: no-remote');
  });

  it('flags a workspace that is not a repository and offers the repair', async () => {
    fixture = createWorkspaceFixture({ initGit: false });
    build(fixture.root);

    await router.handleUpdate(message('/doctor'));

    expect(sent[0]).toContain('❌ git:');
    expect(sent[0]).toContain('/doctor init');
  });

  it('initializes the repository on explicit confirmation, ignoring generated files', async () => {
    fixture = createWorkspaceFixture({ initGit: false });
    fixture.write('draft/01-first.md', 'generated\n');
    build(fixture.root);

    await router.handleUpdate(message('/doctor init'));

    expect(sent[0]).toContain('git 저장소를 초기화했습니다');
    expect(sent[0]).toContain('이제 편집 명령을 쓸 수 있습니다');
    expect(git(fixture.root, 'ls-files')).not.toContain('draft/01-first.md');
  });
});
