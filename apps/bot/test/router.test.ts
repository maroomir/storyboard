import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseCard } from '@storyboard/story-format';
import { GitClient, SyncService } from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatContext } from '../src/chat/context';
import { createDoctorHandler, type DoctorEnvironment } from '../src/chat/handlers/doctor';
import { legacyConfigBridge } from './configurationStub';
import { createRenameHandler, createSetHandler } from '../src/chat/handlers/edit';
import { createNarratorHandler } from '../src/chat/handlers/narrator';
import { createSceneCommandHandler } from '../src/chat/handlers/scene';
import {
  createBibleHandler,
  createCardsHandler,
  createReadDraftHandler,
  createScenesHandler,
  createShowHandler,
  createStartHandler,
  createStatusHandler,
  createSyncHandler,
} from '../src/chat/handlers/read';
import type {
  IncomingUpdate,
  MessageView,
  OutgoingDocument,
  SentMessageRef,
} from '../src/chat/ports';
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

function callback(data: string): IncomingUpdate {
  return { kind: 'callback', chatId: 1, userId: 1, messageId: 1, callbackQueryId: 'q1', data };
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
    fixture.write('scene/01-prologue.card', 'type: scene\nid: 01-prologue\nsummary: prologue\n');
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
      createStartHandler(),
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
      'storyboard-bot: update character/elia.card',
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

  it('answers /help with the same summary as /start', async () => {
    await router.handleUpdate(message('/help'));

    expect(sent[0]).toContain('/cards');
    expect(sent[0]).toContain('/doctor');
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

  function build(root: string, environment: Partial<DoctorEnvironment> = {}): void {
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
    registry.register(
      createDoctorHandler({
        configFile: join(root, 'absent-config.json'),
        configBridge: legacyConfigBridge(undefined),
        hasApiKey: async () => true,
        remote: undefined,
        ...environment,
      }),
    );
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

  it('refuses to initialize without a git identity instead of failing opaquely', async () => {
    fixture = createWorkspaceFixture({ initGit: false });
    build(fixture.root);

    const configuredGlobal = process.env.GIT_CONFIG_GLOBAL;
    const emptyConfig = join(mkdtempSync(join(tmpdir(), 'storyboard-bot-no-identity-')), 'global');
    writeFileSync(emptyConfig, '', 'utf8');
    process.env.GIT_CONFIG_GLOBAL = emptyConfig;

    try {
      await router.handleUpdate(message('/doctor init'));
    } finally {
      process.env.GIT_CONFIG_GLOBAL = configuredGlobal;
    }

    expect(sent[0]).toContain('git 사용자 정보');
    expect(existsSync(join(fixture.root, '.git'))).toBe(false);
  });

  // Hand-authored cards use inline sequences and their own key order. Normalizing is offered as a
  // separate command so it never rides along inside a content edit's diff.
  it('flags hand-authored card formatting and normalizes it in one commit on confirmation', async () => {
    fixture = createWorkspaceFixture();
    const handAuthored = [
      'type: character',
      'id: seoha',
      'name: 서하',
      'tags: [기억 세공사, 유년 기억 상실]',
      'voice:',
      '  - 짧고 건조한 사무체',
      'role: main',
      '',
    ].join('\n');
    fixture.write('character/seoha.card', handAuthored);
    fixture.git('add', '--all');
    fixture.git('commit', '--quiet', '-m', 'add hand-authored card');
    build(fixture.root);

    await router.handleUpdate(message('/doctor'));
    expect(sent[0]).toContain('표준 서식이 아닌 카드 1개: seoha');
    expect(sent[0]).toContain('/doctor format');

    await router.handleUpdate(message('/doctor format'));

    expect(sent[1]).toContain('카드 1개를 표준 서식으로 정리했습니다');
    expect(git(fixture.root, 'show', '--name-only', '--format=', 'HEAD')).toBe(
      'character/seoha.card',
    );
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe(
      'storyboard-bot: normalize card formatting',
    );
    expect(git(fixture.root, 'status', '--porcelain')).toBe('');

    // Content is preserved; only the layout changed.
    const normalized = readFileSync(join(fixture.root, 'character', 'seoha.card'), 'utf8');
    expect(normalized).toContain('  - 기억 세공사');
    expect(normalized).not.toContain('tags: [');
    expect(parseCard(normalized)).toEqual(parseCard(handAuthored));

    // Running it again is a no-op, and a later report stays quiet.
    sent.length = 0;
    await router.handleUpdate(message('/doctor format'));
    expect(sent[0]).toContain('이미 표준 서식입니다');

    await router.handleUpdate(message('/doctor'));
    expect(sent[1]).not.toContain('표준 서식이 아닌');
  });

  it('reports a missing provider CLI as the reason generation would fail', async () => {
    fixture = createWorkspaceFixture();
    build(fixture.root, {
      configBridge: legacyConfigBridge({
        default: 'claude-code',
        models: { 'claude-code': { command: '/nope/claude' } },
      }),
    });

    await router.handleUpdate(message('/doctor'));

    expect(sent[0]).toContain('❌ 프로바이더 claude-code');
    expect(sent[0]).toContain('/nope/claude');
  });

  it('reports a missing API key as the reason generation would fail', async () => {
    fixture = createWorkspaceFixture();
    build(fixture.root, {
      configBridge: legacyConfigBridge({ default: 'openai' }),
      hasApiKey: async () => false,
    });

    await router.handleUpdate(message('/doctor'));

    expect(sent[0]).toContain('❌ 프로바이더 openai');
    expect(sent[0]).toContain('API 키가 없어');
  });

  it('reports a resolvable provider CLI with the path it found', async () => {
    fixture = createWorkspaceFixture();
    build(fixture.root, {
      configBridge: legacyConfigBridge({
        default: 'claude-code',
        models: { 'claude-code': { command: process.execPath } },
      }),
    });

    await router.handleUpdate(message('/doctor'));

    expect(sent[0]).toContain(`✅ 프로바이더 claude-code: ${process.execPath}`);
  });

  it('stays quiet about CLI providers when only mock is configured', async () => {
    fixture = createWorkspaceFixture();
    build(fixture.root, { configBridge: legacyConfigBridge({ default: 'mock' }) });

    await router.handleUpdate(message('/doctor'));

    expect(sent[0]).toContain('ℹ️ 프로바이더: mock (키·실행 파일 불필요)');
  });

  it('reports a configured remote that the repository does not have', async () => {
    fixture = createWorkspaceFixture();
    build(fixture.root, { remote: 'origin' });

    await router.handleUpdate(message('/doctor'));

    expect(sent[0]).toContain('❌ 원격 `origin`이 저장소에 없습니다');
  });

  // A tracked file the user edited in the extension but has not committed: the bot reports it and
  // leaves it alone, because its own commits name explicit paths.
  it('reports uncommitted tracked changes without touching them', async () => {
    fixture = createWorkspaceFixture();
    copySharedFixture(fixture, 'cards', 'character.card', 'character/elia.card');
    fixture.git('add', '--all');
    fixture.git('commit', '--quiet', '-m', 'add card');
    fixture.write('character/elia.card', 'type: character\nid: elia\nname: 편집 중\n');
    build(fixture.root);

    await router.handleUpdate(message('/doctor'));

    expect(sent[0]).toContain('⚠️ 커밋되지 않은 변경이 있습니다');
    expect(git(fixture.root, 'status', '--porcelain')).toContain('character/elia.card');
  });

  // SECURITY: the boot check logs this, but an operator who only ever sees Telegram would miss it.
  it('surfaces a world-readable config file as a permission warning', async () => {
    fixture = createWorkspaceFixture();
    fixture.write('loose-config.json', '{}\n');
    const configFile = join(fixture.root, 'loose-config.json');
    chmodSync(configFile, 0o644);
    build(fixture.root, { configFile });

    await router.handleUpdate(message('/doctor'));

    expect(sent[0]).toContain('설정 파일 권한이 0644입니다');
  });
});

describe('/read', () => {
  let fixture: WorkspaceFixture;
  let router: UpdateRouter;
  let sent: MessageView[];
  let docs: OutgoingDocument[];

  function build(root: string, options = { minimizeChatBody: false }): void {
    const store = new WorkspaceStore(root);
    const client = new GitClient(root);
    const sync = new SyncService(client, {}, silentLogger);
    const gate = new MutateGate(store, client, sync, silentLogger, {
      isTrackedPath: createGitTrackedPathPredicate(client),
    });
    const content = new ContentService(store, gate);
    const sender = {
      sendMessage: async (_c: number, view: MessageView): Promise<SentMessageRef> => {
        sent.push(view);
        return { chatId: 1, messageId: sent.length };
      },
      editMessage: async (ref: SentMessageRef): Promise<SentMessageRef> => ref,
      answerCallback: async (): Promise<void> => undefined,
      sendDocument: async (_c: number, doc: OutgoingDocument): Promise<SentMessageRef> => {
        docs.push(doc);
        return { chatId: 1, messageId: 0 };
      },
    };
    const registry = new CommandRegistry();
    registry.register(createReadDraftHandler(options));
    router = new UpdateRouter({
      sender,
      registry,
      buildContext: (update) => new ChatContext(update, sender, content, store, sync),
      logger: silentLogger,
    });
  }

  beforeEach(() => {
    sent = [];
    docs = [];
    fixture = createWorkspaceFixture();
    fixture.write('scene/01-prologue.card', 'type: scene\nid: 01-prologue\nsummary: prologue\n');
    fixture.write('scene/02-turn.card', 'type: scene\nid: 02-turn\nsummary: turn\n');
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('sends a short draft inline with its length header', async () => {
    fixture.write('draft/01-prologue.md', '짧은 초안 본문');
    build(fixture.root);

    await router.handleUpdate(message('/read 01-prologue'));

    expect(sent[0]?.text).toContain('📄 01-prologue');
    expect(sent[0]?.text).toContain('짧은 초안 본문');
    expect(docs).toHaveLength(0);
  });

  it('switches to preview plus Markdown attachment for a long draft', async () => {
    const body = '가'.repeat(4000);
    fixture.write('draft/01-prologue.md', body);
    build(fixture.root);

    await router.handleUpdate(message('/read 01-prologue'));

    expect(sent[0]?.text).toContain('…');
    expect(sent[0]?.text.length).toBeLessThan(1000);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.fileName).toBe('01-prologue.md');
    expect(new TextDecoder().decode(docs[0]?.bytes)).toBe(body);
  });

  // Privacy mode (BG-05): the body must not enter the chat transcript at all.
  it('sends only the attachment when minimizeChatBody is on', async () => {
    fixture.write('draft/01-prologue.md', '민감한 본문');
    build(fixture.root, { minimizeChatBody: true });

    await router.handleUpdate(message('/read 01-prologue'));

    expect(sent).toHaveLength(0);
    expect(docs).toHaveLength(1);
    expect(new TextDecoder().decode(docs[0]?.bytes)).toBe('민감한 본문');
  });

  it('offers drafted scenes as inline buttons when called bare', async () => {
    fixture.write('draft/01-prologue.md', 'a');
    build(fixture.root);

    await router.handleUpdate(message('/read'));

    expect(sent[0]?.keyboard).toEqual([[{ text: '01-prologue', callbackData: 'rd:01-prologue' }]]);
  });

  it('opens a draft from its inline button callback', async () => {
    fixture.write('draft/01-prologue.md', '버튼으로 연 초안');
    build(fixture.root);

    await router.handleUpdate(callback('rd:01-prologue'));

    expect(sent[0]?.text).toContain('버튼으로 연 초안');
  });

  it('guides generation when the draft is missing and rejects unknown scenes', async () => {
    build(fixture.root);

    await router.handleUpdate(message('/read 02-turn'));
    expect(sent[0]?.text).toContain('아직 초안이 없습니다');
    expect(sent[0]?.keyboard).toEqual([[{ text: '지금 생성', callbackData: 'rd:gen:02-turn' }]]);

    await router.handleUpdate(message('/read 99-nope'));
    expect(sent[1]?.text).toContain('씬을 찾을 수 없습니다');
  });
});

describe('/scene', () => {
  let fixture: WorkspaceFixture;
  let router: UpdateRouter;
  let sent: MessageView[];

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
        sent.push(view);
        return { chatId: 1, messageId: sent.length };
      },
      editMessage: async (ref: SentMessageRef): Promise<SentMessageRef> => ref,
      answerCallback: async (): Promise<void> => undefined,
      sendDocument: async (): Promise<SentMessageRef> => ({ chatId: 1, messageId: 0 }),
    };
    const registry = new CommandRegistry();
    registry.register(createSceneCommandHandler());
    registry.register(createNarratorHandler());
    router = new UpdateRouter({
      sender,
      registry,
      buildContext: (update) => new ChatContext(update, sender, content, store, sync),
      logger: silentLogger,
    });
  }

  beforeEach(() => {
    sent = [];
    fixture = createWorkspaceFixture();
    fixture.write(
      'scene/01-prologue.card',
      'type: scene\nid: 01-prologue\nsummary: prologue seed\n',
    );
    fixture.git('add', '--all');
    fixture.git('commit', '--quiet', '-m', 'seed scenes');
    build(fixture.root);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  // The end-to-end create path: numbering follows the existing scenes, the prose lands in the
  // summary file, and the card plus the file are one commit.
  it('creates the next-numbered scene with a summary file and commits both', async () => {
    await router.handleUpdate(
      message('/scene new first-kiss\n골목에서 우연히 마주친다.\n비가 온다.'),
    );

    expect(sent[0]?.text).toContain('씬을 만들었습니다: 02-first-kiss');
    expect(readFileSync(join(fixture.root, 'scene', '02-first-kiss.card'), 'utf8')).toBe(
      'type: scene\nid: 02-first-kiss\nsummary: 02-first-kiss.summary.md\n',
    );
    expect(readFileSync(join(fixture.root, 'scene', '02-first-kiss.summary.md'), 'utf8')).toBe(
      '골목에서 우연히 마주친다.\n비가 온다.\n',
    );
    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe(
      'storyboard-bot: create scene/02-first-kiss.card',
    );
    expect(git(fixture.root, 'status', '--porcelain')).toBe('');
  });

  it('rejects an invalid slug and a bodyless create without writing', async () => {
    await router.handleUpdate(message('/scene new 한글슬러그\n본문'));
    expect(sent[0]?.text).toContain('슬러그');

    await router.handleUpdate(message('/scene new valid-slug'));
    expect(sent[1]?.text).toContain('본문');

    expect(git(fixture.root, 'log', '-1', '--format=%s')).toBe('seed scenes');
  });

  it('replaces the summary file while leaving a referencing card untouched', async () => {
    fixture.write(
      'scene/03-meet.card',
      'type: scene\nid: 03-meet\ntitle: 만남\ncharacters:\n  - elia\nsummary: 03-meet.summary.md\n',
    );
    fixture.write('scene/03-meet.summary.md', '예전 본문\n');
    fixture.git('add', '--all');
    fixture.git('commit', '--quiet', '-m', 'add frontmatter scene');

    await router.handleUpdate(message('/scene edit 03-meet\n새 본문입니다.'));

    expect(sent[0]?.text).toContain('본문을 교체했습니다');
    expect(readFileSync(join(fixture.root, 'scene', '03-meet.card'), 'utf8')).toBe(
      'type: scene\nid: 03-meet\ntitle: 만남\ncharacters:\n  - elia\nsummary: 03-meet.summary.md\n',
    );
    expect(readFileSync(join(fixture.root, 'scene', '03-meet.summary.md'), 'utf8')).toBe(
      '새 본문입니다.\n',
    );
    expect(git(fixture.root, 'show', '--stat', '--format=', 'HEAD')).not.toContain('03-meet.card');
  });

  // A card that still carries inline prose is moved to the summary file on its first edit.
  it('appends to an inline summary by moving it into the summary file', async () => {
    await router.handleUpdate(message('/scene append 01-prologue\n덧붙인 문단.'));

    expect(sent[0]?.text).toContain('덧붙였습니다');
    expect(readFileSync(join(fixture.root, 'scene', '01-prologue.card'), 'utf8')).toBe(
      'type: scene\nid: 01-prologue\nsummary: 01-prologue.summary.md\n',
    );
    expect(readFileSync(join(fixture.root, 'scene', '01-prologue.summary.md'), 'utf8')).toBe(
      'prologue seed\n\n덧붙인 문단.\n',
    );
    expect(git(fixture.root, 'status', '--porcelain')).toBe('');
  });

  it('rejects edits to unknown scenes and shows usage for malformed input', async () => {
    await router.handleUpdate(message('/scene edit 99-nope\n본문'));
    expect(sent[0]?.text).toContain('씬을 찾을 수 없습니다');

    await router.handleUpdate(message('/scene'));
    expect(sent[1]?.text).toContain('사용법');

    await router.handleUpdate(message('/scene delete 01-prologue'));
    expect(sent[2]?.text).toContain('사용법');

    await router.handleUpdate(message('/scene beats 01-prologue now'));
    expect(sent[3]?.text).toContain('사용법');
  });
  it('reports the narration a scene will be generated with', async () => {
    await router.handleUpdate(message('/scene show 01-prologue'));

    expect(sent[0]?.text).toContain('시점: 3인칭 · 목격 범위');
    expect(sent[0]?.text).toContain('줄기: main');
  });

  it('names the narrator card a scene points at', async () => {
    fixture.write(
      'narrator/hana-first.card',
      'type: narrator\nid: hana-first\nname: 하나\nperson: first\nknowledge: retrospective\nfocal: hana\n',
    );
    fixture.write(
      'scene/01-prologue.card',
      'type: scene\nid: 01-prologue\nnarrator: hana-first\nthread: ep2\nsummary: prologue\n',
    );

    await router.handleUpdate(message('/scene show 01-prologue'));

    expect(sent[0]?.text).toContain('1인칭 · 회고');
    expect(sent[0]?.text).toContain('줄기: ep2');
  });

  it('says which narrator a scene names when its card is missing', async () => {
    fixture.write(
      'scene/01-prologue.card',
      'type: scene\nid: 01-prologue\nnarrator: ghost\nsummary: prologue\n',
    );

    await router.handleUpdate(message('/scene show 01-prologue'));

    expect(sent[0]?.text).toContain('ghost');
  });

  it('falls back to the contract point of view when no narrator card exists', async () => {
    await router.handleUpdate(message('/narrator'));

    expect(sent[0]?.text).toContain('작품 기본 시점: 3인칭 · 목격 범위');
    expect(sent[0]?.text).toContain('서술자 카드가 없어');
  });

  it('creates a narrator card as its own commit', async () => {
    await router.handleUpdate(message('/narrator add wide third omniscient'));

    expect(sent[0]?.text).toContain('narrator/wide.card');
    expect(existsSync(join(fixture.root, 'narrator', 'wide.card'))).toBe(true);
    expect(git(fixture.root, 'status', '--porcelain')).toBe('');
  });

  it('refuses a person the format does not define', async () => {
    await router.handleUpdate(message('/narrator add wide fourth witnessed'));

    expect(sent[0]?.text).toContain('first, second, third');
    expect(existsSync(join(fixture.root, 'narrator', 'wide.card'))).toBe(false);
  });

});
