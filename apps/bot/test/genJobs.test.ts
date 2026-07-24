import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GitClient, SyncService } from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAiService } from '../src/ai/aiGateway';
import { ChatContext } from '../src/chat/context';
import {
  createDraftCommandHandler,
  createJobsHandler,
  createManuscriptCommandHandler,
  createOutlineCommandHandler,
} from '../src/chat/handlers/generate';
import type { IncomingUpdate, MessageView, SentMessageRef } from '../src/chat/ports';
import { CommandRegistry } from '../src/chat/registry';
import { UpdateRouter } from '../src/chat/router';
import { ContentService } from '../src/content/contentService';
import { createGenJobs, type GenJobs } from '../src/app/createGenJobs';
import { openDatabase, type StorygramDatabase } from '../src/store/db';
import { MutateGate, createDefaultTrackedPathPredicate } from '../src/workspace/mutateGate';
import { WorkspaceStore, hashContent } from '../src/workspace/workspaceStore';
import {
  copySharedFixture,
  createWorkspaceFixture,
  type WorkspaceFixture,
} from './helpers/workspaceFixture';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function message(text: string): IncomingUpdate {
  return { kind: 'message', chatId: 1, userId: 1, messageId: 1, text };
}

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('condition not reached in time');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe('generation jobs end to end', () => {
  let fixture: WorkspaceFixture;
  let dbDir: string;
  let db: StorygramDatabase;
  let genJobs: GenJobs;
  let router: UpdateRouter;
  let sent: string[];
  let store: WorkspaceStore;

  beforeEach(() => {
    vi.clearAllMocks();
    sent = [];
    fixture = createWorkspaceFixture();
    copySharedFixture(fixture, 'cards', 'character.card', 'character/elia.card');
    copySharedFixture(fixture, 'cards', 'background.card', 'background/school.card');
    fixture.write(
      'scene/01-prologue.txt',
      ['---', 'title: 프롤로그', 'characters: [elia]', 'location: school', '---', '엘리아의 첫 장면.', ''].join('\n'),
    );
    execFileSync('git', ['-C', fixture.root, 'add', '--all'], { shell: false });
    execFileSync('git', ['-C', fixture.root, 'commit', '--quiet', '-m', 'seed'], { shell: false });

    store = new WorkspaceStore(fixture.root);
    const client = new GitClient(fixture.root);
    const sync = new SyncService(client, {}, silentLogger);
    const gate = new MutateGate(store, client, sync, silentLogger, {
      isTrackedPath: createDefaultTrackedPathPredicate(),
    });
    const content = new ContentService(store, gate);
    const aiService = createAiService({ providers: { default: 'mock' } });

    const sender = {
      sendMessage: async (_chatId: number, view: MessageView): Promise<SentMessageRef> => {
        sent.push(view.text);
        return { chatId: 1, messageId: sent.length };
      },
      editMessage: async (_ref: SentMessageRef, view: MessageView): Promise<void> => {
        sent.push(view.text);
      },
      answerCallback: async (): Promise<void> => undefined,
      sendDocument: async (): Promise<SentMessageRef> => ({ chatId: 1, messageId: 0 }),
    };

    dbDir = mkdtempSync(join(tmpdir(), 'storygram-db-'));
    db = openDatabase(join(dbDir, 'state.db'));

    genJobs = createGenJobs({
      db,
      store,
      content,
      aiService,
      draftGenerator: {
        generate: async (sceneStem) => `# ${sceneStem}\n\n생성된 본문입니다.\n`,
      },
      sender,
      jobsConfig: { heavyConcurrency: 1, lightConcurrency: 1 },
      logger: silentLogger,
    });
    genJobs.start();

    const registry = new CommandRegistry();
    for (const handler of [
      createDraftCommandHandler(),
      createOutlineCommandHandler(),
      createManuscriptCommandHandler(),
      createJobsHandler(),
    ]) {
      registry.register(handler);
    }

    router = new UpdateRouter({
      sender,
      registry,
      buildContext: (update) =>
        new ChatContext(update, sender, content, store, sync, genJobs.manager),
      logger: silentLogger,
    });
  });

  afterEach(async () => {
    await genJobs.stop();
    db.close();
    rmSync(dbDir, { recursive: true, force: true });
    fixture.cleanup();
  });

  it('runs /draft as a queued job and writes the draft without committing', async () => {
    await router.handleUpdate(message('/draft 01-prologue'));

    await waitFor(() => existsSync(join(fixture.root, 'draft', '01-prologue.md')));
    await waitFor(() => sent.some((text) => text.includes('✅ 잡')));

    expect(readFileSync(join(fixture.root, 'draft', '01-prologue.md'), 'utf8')).toContain(
      '생성된 본문',
    );
    // Fixture init + seed only: the draft itself must not add a commit.
    const log = execFileSync('git', ['-C', fixture.root, 'log', '--format=%s'], {
      encoding: 'utf8',
      shell: false,
    }).trim();
    expect(log.split('\n')).toHaveLength(2);
  });

  it('runs /outline and commits synopsis.md with the enqueue baseline', async () => {
    await router.handleUpdate(message('/outline'));

    await waitFor(() =>
      existsSync(join(fixture.root, '.storyboard', 'outline', 'synopsis.md')),
    );
    await waitFor(() => sent.some((text) => text.includes('✅ 잡')));

    const log = execFileSync('git', ['-C', fixture.root, 'log', '-1', '--format=%s'], {
      encoding: 'utf8',
      shell: false,
    }).trim();
    expect(log).toBe('storygram: generate .storyboard/outline/synopsis.md');
  });

  // Decision #14: a Desktop edit landing while the job runs must win over the generated output.
  it('fails the outline job instead of clobbering a Desktop edit made after enqueue', async () => {
    fixture.write('.storyboard/outline/synopsis.md', '# 시놉시스\n\n## 로그라인\n\n원래 내용\n');
    const originalHash = hashContent(readFileSync(join(fixture.root, '.storyboard/outline/synopsis.md'), 'utf8'));

    // Simulate the enqueue-then-desktop-edit race by enqueueing with the pre-edit baseline and
    // editing the file before the worker picks the job up.
    genJobs.manager.enqueue({
      kind: 'outline',
      class: 'heavy',
      target: { file: '.storyboard/outline/synopsis.md' },
      options: { baselineHash: originalHash },
      chatId: 1,
    });
    fixture.write('.storyboard/outline/synopsis.md', '# 시놉시스\n\n## 로그라인\n\nDesktop이 고친 내용\n');

    await waitFor(() => sent.some((text) => text.includes('❌ 잡')));

    expect(readFileSync(join(fixture.root, '.storyboard/outline/synopsis.md'), 'utf8')).toContain(
      'Desktop이 고친 내용',
    );
  });

  it('fails /manuscript cleanly when no chapter plan exists', async () => {
    await router.handleUpdate(message('/manuscript'));

    await waitFor(() => sent.some((text) => text.includes('❌ 잡')));
    expect(sent.join('\n')).toContain('/plan');
  });

  it('rejects a duplicate job for the same target', async () => {
    genJobs.manager.enqueue({
      kind: 'draft',
      class: 'heavy',
      target: { scene: '01-prologue' },
      chatId: 1,
    });
    await router.handleUpdate(message('/draft 01-prologue'));

    expect(sent.some((text) => text.includes('이미 진행 중'))).toBe(true);

    await waitFor(() => sent.some((text) => text.includes('✅ 잡')));
  });

  it('lists jobs with /jobs', async () => {
    await router.handleUpdate(message('/draft 01-prologue'));
    await waitFor(() => sent.some((text) => text.includes('✅ 잡')));

    await router.handleUpdate(message('/jobs'));

    const listing = sent[sent.length - 1] ?? '';
    expect(listing).toContain('초안 생성 01-prologue');
    expect(listing).toContain('succeeded');
  });
});
