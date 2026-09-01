import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseDraft, type BackgroundCard, type CharacterCard } from '@storyboard/story-format';
import { GitClient, SyncService } from '@storyboard/story-git';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAiEngine } from '../src/ai/aiGateway';
import { ContentService } from '../src/content/contentService';
import {
  NodeUri,
  createBackgroundMemoryStore,
  createPersonaMemoryStore,
  getStoryboardProjectPaths,
} from '@storyboard/story-engine';
import { BotFileSystem } from '../src/gen/engineAdapters';
import { DraftPipeline, type DraftGenerator } from '../src/gen/draftPipeline';
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
      'scene/01-prologue.card',
      [
        'type: scene',
        'id: 01-prologue',
        'title: 프롤로그',
        'characters:',
        '  - elia',
        'location: school',
        'mood: 시작',
        'summary: 엘리아가 학교에서 첫 장면을 시작한다.',
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
    const draftConfig = {
      reviseAfterGenerate: false,
      reviseMaxIterations: 2,
      autoGrounding: false,
    };
    const engine = createAiEngine({ providers: { default: 'mock' }, draft: draftConfig });
    const generator = new SceneDraftGenerator({
      store,
      content,
      registry: engine.registry,
      configBridge: engine.configBridge,
      autoGrounding: draftConfig.autoGrounding,
      onUsage: () => undefined,
      generator: 'storyboard-bot@0.0.0-test',
    });
    const pipeline = new DraftPipeline({ store, content, generator });

    const result = await pipeline.run(job('01-prologue'), context());

    expect(result).toMatchObject({ success: true });
    expect(result.resultRef).toBe('draft/01-prologue.md');

    const draftText = readFileSync(join(fixture.root, 'draft', '01-prologue.md'), 'utf8');
    const draft = parseDraft(draftText);
    expect(draft.body.length).toBeGreaterThan(0);
    expect(draft.generator).toBe('storyboard-bot@0.0.0-test');
    expect(draft.providerId).toBe('mock');
    expect(draft.model).toBeDefined();

    // draft/ is gitignored, so generation must not add a commit.
    const log = execFileSync('git', ['-C', fixture.root, 'log', '--format=%s'], {
      encoding: 'utf8',
      shell: false,
    }).trim();
    expect(log.split('\n')).toHaveLength(2);
  });

  // Ported from the extension: the four grounding facts are settled before the dialogue prompt
  // runs, and `scene/` is tracked so filling them is a commit of its own.
  it('fills missing scene grounding and commits it to the scene frontmatter', async () => {
    const draftConfig = { reviseAfterGenerate: false, reviseMaxIterations: 2, autoGrounding: true };
    const engine = createAiEngine({ providers: { default: 'mock' }, draft: draftConfig });
    const generator = new SceneDraftGenerator({
      store,
      content,
      registry: engine.registry,
      configBridge: engine.configBridge,
      autoGrounding: draftConfig.autoGrounding,
      onUsage: () => undefined,
      generator: 'storyboard-bot@0.0.0-test',
    });

    await generator.generate('01-prologue', () => false);

    const scene = await store.readScene('01-prologue');
    expect(scene.value.frontmatter.grounding).toBeDefined();
    // The grounding write re-serializes the card canonically but keeps every other field.
    const raw = readFileSync(join(fixture.root, 'scene', '01-prologue.card'), 'utf8');
    expect(raw).toContain('characters:\n  - elia');
    expect(raw).toContain('grounding:');
    expect(raw).toContain('엘리아가 학교에서 첫 장면을 시작한다.');

    const log = fixture.git('log', '--format=%s').split('\n');
    expect(log[0]).toBe('storyboard-bot: ground scene/01-prologue.card');
  });

  it('leaves the scene untouched when auto grounding is off', async () => {
    const draftConfig = {
      reviseAfterGenerate: false,
      reviseMaxIterations: 2,
      autoGrounding: false,
    };
    const engine = createAiEngine({ providers: { default: 'mock' }, draft: draftConfig });
    const before = readFileSync(join(fixture.root, 'scene', '01-prologue.card'), 'utf8');
    const logBefore = fixture.git('log', '--format=%s');
    const generator = new SceneDraftGenerator({
      store,
      content,
      registry: engine.registry,
      configBridge: engine.configBridge,
      autoGrounding: draftConfig.autoGrounding,
      onUsage: () => undefined,
      generator: 'storyboard-bot@0.0.0-test',
    });

    await generator.generate('01-prologue', () => false);

    expect(readFileSync(join(fixture.root, 'scene', '01-prologue.card'), 'utf8')).toBe(before);
    expect(fixture.git('log', '--format=%s')).toBe(logBefore);
  });

  it('keeps user-authored grounding and only fills the empty fields', async () => {
    fixture.write(
      'scene/01-prologue.card',
      [
        'type: scene',
        'id: 01-prologue',
        'title: 프롤로그',
        'characters:',
        '  - elia',
        'location: school',
        'grounding:',
        '  incident: 사용자가 적어 둔 사건',
        'summary: 엘리아가 학교에서 첫 장면을 시작한다.',
        '',
      ].join('\n'),
    );
    fixture.git('add', '--all');
    fixture.git('commit', '--quiet', '-m', 'author grounding');

    const draftConfig = { reviseAfterGenerate: false, reviseMaxIterations: 2, autoGrounding: true };
    const engine = createAiEngine({ providers: { default: 'mock' }, draft: draftConfig });
    const generator = new SceneDraftGenerator({
      store,
      content,
      registry: engine.registry,
      configBridge: engine.configBridge,
      autoGrounding: draftConfig.autoGrounding,
      onUsage: () => undefined,
      generator: 'storyboard-bot@0.0.0-test',
    });

    await generator.generate('01-prologue', () => false);

    const grounding = (await store.readScene('01-prologue')).value.frontmatter.grounding;
    expect(grounding?.incident).toBe('사용자가 적어 둔 사건');
  });

  it('fails cleanly when the scene disappeared while the job was queued', async () => {
    const draftConfig = {
      reviseAfterGenerate: false,
      reviseMaxIterations: 2,
      autoGrounding: false,
    };
    const engine = createAiEngine({ providers: { default: 'mock' }, draft: draftConfig });
    const generator = new SceneDraftGenerator({
      store,
      content,
      registry: engine.registry,
      configBridge: engine.configBridge,
      autoGrounding: draftConfig.autoGrounding,
      onUsage: () => undefined,
      generator: 'storyboard-bot@0.0.0-test',
    });
    const pipeline = new DraftPipeline({ store, content, generator });

    const result = await pipeline.run(job('99-missing'), context());

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain('99-missing');
  });

  // Decision #31: the shared review→revise loop runs after generation unless the operator turns
  // it off in config.
  it('runs the shared revise loop after generation when the gate is on', async () => {
    const stages: string[] = [];
    const draftConfig = { reviseAfterGenerate: true, reviseMaxIterations: 2, autoGrounding: false };
    const engine = createAiEngine({ providers: { default: 'mock' }, draft: draftConfig });
    const generator = new SceneDraftGenerator({
      store,
      content,
      registry: engine.registry,
      configBridge: engine.configBridge,
      autoGrounding: draftConfig.autoGrounding,
      onUsage: () => undefined,
      generator: 'storyboard-bot@0.0.0-test',
      onStage: (stage) => {
        stages.push(stage);
      },
    });

    const generated = await generator.generate('01-prologue', () => false);

    expect(generated).toMatchObject({ status: 'written' });
    expect(stages.some((stage) => stage.startsWith('검사 중'))).toBe(true);
  });

  it('skips the revise loop when the gate is off', async () => {
    const stages: string[] = [];
    const draftConfig = {
      reviseAfterGenerate: false,
      reviseMaxIterations: 2,
      autoGrounding: false,
    };
    const engine = createAiEngine({ providers: { default: 'mock' }, draft: draftConfig });
    const generator = new SceneDraftGenerator({
      store,
      content,
      registry: engine.registry,
      configBridge: engine.configBridge,
      autoGrounding: draftConfig.autoGrounding,
      onUsage: () => undefined,
      generator: 'storyboard-bot@0.0.0-test',
      onStage: (stage) => {
        stages.push(stage);
      },
    });

    await generator.generate('01-prologue', () => false);

    expect(stages.some((stage) => stage.startsWith('검사 중'))).toBe(false);
  });

  // Generation now uses the engine's own memory stores, so the round trip is asserted against those
  // — the extension's exact record format, an edited card treated as a miss, and no commit
  // (.storyboard/cache/ is gitignored).
  it('round-trips persona and background memory through the shared codec', async () => {
    const character = (await store.readCard('character', 'elia')).value as CharacterCard;
    const background = (await store.readCard('background', 'school')).value as BackgroundCard;
    const commitsBefore = fixture.git('log', '--format=%s').split('\n').length;

    const paths = getStoryboardProjectPaths(NodeUri.file(fixture.root));
    const fileSystem = new BotFileSystem(content, NodeUri.file(fixture.root));

    const personaStore = createPersonaMemoryStore(fileSystem, paths, '01-prologue');
    await personaStore.save(character, '조용하지만 단단한 화자.');
    expect(await personaStore.load(character)).toBe('조용하지만 단단한 화자.');

    const backgroundStore = createBackgroundMemoryStore(fileSystem, paths, '01-prologue');
    await backgroundStore.save(background, '봄비 냄새가 남은 복도.');
    expect(await backgroundStore.load(background)).toBe('봄비 냄새가 남은 복도.');

    const editedCharacter = { ...character, name: `${character.name}2` };
    expect(await personaStore.load(editedCharacter)).toBeUndefined();

    expect(fixture.git('log', '--format=%s').split('\n')).toHaveLength(commitsBefore);
  });

  // The engine builds its own AI service per use case, so the job ledger only sees generation cost
  // if the generator forwards it. A no-op here silently zeroes every /draft job's usage row.
  it('forwards provider usage to the job ledger', async () => {
    const usage: unknown[] = [];
    const draftConfig = {
      reviseAfterGenerate: false,
      reviseMaxIterations: 2,
      autoGrounding: false,
    };
    const engine = createAiEngine({ providers: { default: 'mock' }, draft: draftConfig });
    const generator = new SceneDraftGenerator({
      store,
      content,
      registry: engine.registry,
      configBridge: engine.configBridge,
      autoGrounding: draftConfig.autoGrounding,
      onUsage: (record) => {
        usage.push(record);
      },
      generator: 'storyboard-bot@0.0.0-test',
    });

    await generator.generate('01-prologue', () => false);

    expect(usage.length).toBeGreaterThan(0);
  });

  it('reports cancellation instead of writing', async () => {
    const generator: DraftGenerator = {
      generate: async () => ({ status: 'cancelled' }),
    };
    const pipeline = new DraftPipeline({ store, content, generator });

    const result = await pipeline.run(
      job('01-prologue'),
      context(() => true),
    );

    expect(result).toEqual({ success: false, failureReason: 'cancelled' });
  });
});
