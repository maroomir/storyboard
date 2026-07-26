import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GitClient, SyncService } from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAiService } from '../src/ai/aiGateway';
import { ContentService } from '../src/content/contentService';
import { DraftPipeline } from '../src/gen/draftPipeline';
import { SceneDraftGenerator } from '../src/gen/sceneDraftGenerator';
import type { GenJob } from '../src/gen/types';
import { MutateGate, createGitTrackedPathPredicate } from '../src/workspace/mutateGate';
import { WorkspaceStore } from '../src/workspace/workspaceStore';
import {
  copySharedFixture,
  createWorkspaceFixture,
  type WorkspaceFixture,
} from './helpers/workspaceFixture';

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function job(scene: string): GenJob {
  return {
    id: 1,
    kind: 'draft',
    class: 'heavy',
    target: { scene },
    targetKey: `scene:${scene}`,
    options: {},
    state: 'running',
    failureReason: null,
    provider: {},
    chatId: 1,
    progressMessageId: null,
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    resultRef: null,
    createdAt: 0,
    startedAt: 0,
    finishedAt: null,
  };
}

function context(isCancelled = (): boolean => false): {
  isCancelled: () => boolean;
  log: () => void;
  reportStage: () => Promise<void>;
  stages: string[];
} {
  const stages: string[] = [];
  return {
    isCancelled,
    log: (): void => undefined,
    reportStage: async (stage?: string): Promise<void> => {
      if (stage) stages.push(stage);
    },
    stages,
  };
}

describe('scene draft generation', () => {
  let fixture: WorkspaceFixture;
  let store: WorkspaceStore;
  let content: ContentService;

  beforeEach(() => {
    vi.clearAllMocks();
    fixture = createWorkspaceFixture();
    copySharedFixture(fixture, 'cards', 'character.card', 'character/elia.card');
    copySharedFixture(fixture, 'cards', 'background.card', 'background/school.card');
    // The shared fixture points at sample ids; wire it to the fixture cards this test copies in.
    fixture.write(
      'scene/01-prologue.txt',
      [
        '---',
        'title: 프롤로그',
        'characters: [elia]',
        'location: school',
        'mood: 시작',
        '---',
        '엘리아가 학교에서 첫 장면을 시작한다.',
        '',
      ].join('\n'),
    );
    execFileSync('git', ['-C', fixture.root, 'add', '--all'], { shell: false });
    execFileSync('git', ['-C', fixture.root, 'commit', '--quiet', '-m', 'seed'], { shell: false });

    store = new WorkspaceStore(fixture.root);
    const client = new GitClient(fixture.root);
    const gate = new MutateGate(
      store,
      client,
      new SyncService(client, {}, silentLogger),
      silentLogger,
      { isTrackedPath: createGitTrackedPathPredicate(client) },
    );
    content = new ContentService(store, gate);
  });

  afterEach(() => {
    fixture.cleanup();
  });

  // The bot runs the extension's staged pipeline, not a bot-specific shortcut.
  it('generates a draft through the shared pipeline and writes it without committing', async () => {
    const generator = new SceneDraftGenerator({
      store,
      aiService: createAiService({ providers: { default: 'mock' } }),
    });
    const pipeline = new DraftPipeline({ store, content, generator });

    const result = await pipeline.run(job('01-prologue'), context());

    expect(result.success).toBe(true);
    expect(result.resultRef).toBe('draft/01-prologue.md');

    const body = readFileSync(join(fixture.root, 'draft', '01-prologue.md'), 'utf8');
    expect(body.length).toBeGreaterThan(0);

    // draft/ is gitignored, so generation must not add a commit.
    const log = execFileSync('git', ['-C', fixture.root, 'log', '--format=%s'], {
      encoding: 'utf8',
      shell: false,
    }).trim();
    expect(log.split('\n')).toHaveLength(2);
  });

  it('fails cleanly when the scene disappeared while the job was queued', async () => {
    const generator = new SceneDraftGenerator({
      store,
      aiService: createAiService({ providers: { default: 'mock' } }),
    });
    const pipeline = new DraftPipeline({ store, content, generator });

    const result = await pipeline.run(job('99-missing'), context());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('99-missing');
  });

  it('reports cancellation instead of writing', async () => {
    const generator = {
      generate: async (): Promise<string> => '생성된 본문',
    };
    const pipeline = new DraftPipeline({ store, content, generator });

    const result = await pipeline.run(
      job('01-prologue'),
      context(() => true),
    );

    expect(result).toEqual({ success: false, failureReason: 'cancelled' });
  });
});
