import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CardPendingChangesDesk,
  RemoveCardUseCase,
  SessionStore,
  SetCardStatementUseCase,
  UnsetCardStatementUseCase,
  WorkspaceCards,
  WorkspaceScenes,
  type StudioProposalApplier,
  type WorkspaceCaches,
} from '@storyboard/story-engine';
import { NodeUri, type Statement } from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readBundleText, testElementId, writeCardBundleFromYaml } from './fixtures/cardBundles';
import { readSceneState, writeSceneBundleFromYaml, writeSceneState } from './fixtures/sceneBundles';
import { createWorkspaceCaches } from './fixtures/workspaceCacheFixture';

let workspace: string;
let caches: WorkspaceCaches;
let cards: WorkspaceCards;
let scenes: WorkspaceScenes;

const eliaId: string = testElementId('character', 'elia');
const seraId: string = testElementId('character', 'sera');

function root(): NodeUri {
  return NodeUri.file(workspace);
}

async function statementsOf(slug: string): Promise<readonly Statement[]> {
  return (await cards.findBundleBySlug(root(), slug))?.statements ?? [];
}

beforeEach(async () => {
  caches = createWorkspaceCaches();
  workspace = mkdtempSync(join(tmpdir(), 'storyboard-statements-'));
  cards = new WorkspaceCards({ fileSystem: new NodeFileSystem(), caches });
  scenes = new WorkspaceScenes({ fileSystem: new NodeFileSystem(), caches, cards });

  writeCardBundleFromYaml(
    workspace,
    [
      'type: character',
      'id: elia',
      'name: 엘리아',
      'role: main',
      'relations:',
      '  - target: sera',
      '    type: 소꿉친구',
    ].join('\n'),
  );
  writeCardBundleFromYaml(workspace, 'type: character\nid: sera\nname: 세라\nrole: supporting\n');
});

afterEach(async () => {
  await caches.closeAll();
  rmSync(workspace, { recursive: true, force: true });
});

describe('SetCardStatementUseCase', () => {
  it('writes the author line to statements.yaml', async () => {
    const result = await new SetCardStatementUseCase(cards).execute({
      workspaceRoot: root(),
      slug: 'elia',
      facet: 'desire',
      value: '짧게 끊어 말한다',
      origin: 'author',
    });

    expect(result).toMatchObject({ ok: true, kind: 'added' });
    expect(readBundleText(workspace, 'character', 'elia')).toContain('짧게 끊어 말한다');
    expect((await statementsOf('elia')).find((line) => line.facet === 'desire')?.source.origin).toBe(
      'author',
    );
  });

  it('keeps an author line from an agent', async () => {
    const set = new SetCardStatementUseCase(cards);
    await set.execute({ workspaceRoot: root(), slug: 'elia', facet: 'speech', about: 'sera', value: '반말', origin: 'author' });

    expect(
      await set.execute({ workspaceRoot: root(), slug: 'elia', facet: 'speech', about: 'sera', value: '존댓말', origin: 'agent' }),
    ).toMatchObject({ ok: false, kind: 'held-by-author' });
  });

  it('refuses a facet the kind does not have and an unknown card', async () => {
    const set = new SetCardStatementUseCase(cards);

    expect(
      await set.execute({ workspaceRoot: root(), slug: 'elia', facet: 'layout', value: '-', origin: 'author' }),
    ).toMatchObject({ ok: false, kind: 'invalid' });
    expect(
      await set.execute({ workspaceRoot: root(), slug: 'nobody', facet: 'desire', value: '-', origin: 'author' }),
    ).toMatchObject({ ok: false, kind: 'missing' });
  });
});

describe('UnsetCardStatementUseCase', () => {
  it('removes the lines that match', async () => {
    await new SetCardStatementUseCase(cards).execute({
      workspaceRoot: root(),
      slug: 'elia',
      facet: 'desire',
      value: '짧게',
      origin: 'author',
    });

    const result = await new UnsetCardStatementUseCase(cards).execute({
      workspaceRoot: root(),
      slug: 'elia',
      facet: 'desire',
    });

    expect(result).toMatchObject({ ok: true, kind: 'removed' });
    expect((await statementsOf('elia')).some((line) => line.facet === 'desire')).toBe(false);
    expect(
      await new UnsetCardStatementUseCase(cards).execute({ workspaceRoot: root(), slug: 'elia', facet: 'desire' }),
    ).toMatchObject({ ok: false, kind: 'missing' });
  });
});

describe('RemoveCardUseCase', () => {
  beforeEach(async () => {
    await writeSceneBundleFromYaml(
      workspace,
      'type: scene\nid: 001-rooftop\ntitle: 옥상\nbeats:\n  - text: 둘이 만난다\n    cast: [elia, sera]\n',
    );
    writeSceneState(workspace, '001-rooftop', {
      statements: [
        { facet: 'reveal', value: '세라만 아는 비밀', knownBy: [seraId] },
        { facet: 'event', value: '둘이 만났다', knownBy: [eliaId, seraId] },
      ],
    });
  });

  it('refuses while something refers to the card, naming the lines it would drop', async () => {
    const result = await new RemoveCardUseCase({ cards, scenes, caches }).execute({
      workspaceRoot: root(),
      slug: 'sera',
      shouldForce: false,
    });

    expect(result).toMatchObject({ ok: false, kind: 'referenced' });
    const plan = (result as { plan: { droppedLines: { value: string }[]; referencingPaths: string[] } }).plan;
    expect(plan.droppedLines.map((line) => line.value)).toEqual(['소꿉친구', '세라만 아는 비밀']);
    expect(plan.referencingPaths).toHaveLength(3);
    expect(await cards.findBundleBySlug(root(), 'sera')).toBeDefined();
  });

  it('only plans the removal when previewing, even with nothing referring to the card', async () => {
    const result = await new RemoveCardUseCase({ cards, scenes, caches }).execute({
      workspaceRoot: root(),
      slug: 'sera',
      shouldForce: true,
      isPreview: true,
    });

    expect(result).toMatchObject({ ok: true, kind: 'previewed' });
    expect(await cards.findBundleBySlug(root(), 'sera')).toBeDefined();
    expect(readSceneState(workspace, '001-rooftop')?.statements).toHaveLength(2);
  });

  it('removes the card and cleans its cast, relations and witnesses when forced', async () => {
    const result = await new RemoveCardUseCase({ cards, scenes, caches }).execute({
      workspaceRoot: root(),
      slug: 'sera',
      shouldForce: true,
    });

    expect(result).toMatchObject({ ok: true, kind: 'removed' });
    expect(await cards.findBundleBySlug(root(), 'sera')).toBeUndefined();
    expect((await statementsOf('elia')).some((line) => line.about === seraId)).toBe(false);
    const scene = await scenes.find(root(), 'rooftop');
    expect(scene?.content.beats[0]?.cast).toEqual([eliaId]);
    expect(readSceneState(workspace, '001-rooftop')?.statements).toEqual([
      { facet: 'event', value: '둘이 만났다', knownBy: [eliaId] },
    ]);
    const history = new SessionStore(await caches.open(root())).listForElement(seraId);
    expect(history).toHaveLength(1);
  });
});

describe('CardPendingChangesDesk', () => {
  const unusedApplier = {} as StudioProposalApplier;

  async function leavePending(statements: readonly Statement[]): Promise<void> {
    new SessionStore(await caches.open(root())).open({
      kind: 'interview',
      elementId: eliaId,
      data: { pendingStatements: statements },
      pendingCount: statements.length,
    });
  }

  const pendingSpeech: Statement = {
    facet: 'desire',
    value: '반말을 쓴다',
    source: { origin: 'interview' },
  };

  it('lists and applies pending lines into statements.yaml', async () => {
    await leavePending([pendingSpeech]);
    const desk = new CardPendingChangesDesk({ cards, caches, applier: unusedApplier });

    const listed = await desk.list(root(), 'elia');
    expect(listed).toMatchObject({ ok: true, report: { changes: [{ origin: 'interview', summary: '1줄' }] } });

    expect(await desk.apply(root(), 'elia')).toMatchObject({ ok: true, report: { applied: 1 } });
    expect((await statementsOf('elia')).some((line) => line.value === '반말을 쓴다')).toBe(true);
    expect(new SessionStore(await caches.open(root())).listWithPending()).toEqual([]);
  });

  it('discards pending lines without writing them', async () => {
    await leavePending([pendingSpeech]);
    const desk = new CardPendingChangesDesk({ cards, caches, applier: unusedApplier });

    expect(await desk.discard(root(), 'elia')).toMatchObject({ ok: true, report: { discarded: 1 } });
    expect((await statementsOf('elia')).some((line) => line.value === '반말을 쓴다')).toBe(false);
    expect(new SessionStore(await caches.open(root())).listWithPending()).toEqual([]);
  });

  it('reports held author lines instead of overwriting them', async () => {
    await new SetCardStatementUseCase(cards).execute({
      workspaceRoot: root(),
      slug: 'elia',
      facet: 'speech',
      about: 'sera',
      value: '존댓말을 쓴다',
      origin: 'author',
    });
    const pendingSpeech: Statement = {
      facet: 'speech',
      about: seraId,
      value: '반말을 쓴다',
      source: { origin: 'interview' },
    };
    await leavePending([pendingSpeech]);

    const applied = await new CardPendingChangesDesk({ cards, caches, applier: unusedApplier }).apply(
      root(),
      'elia',
    );

    expect(applied).toMatchObject({ ok: true, report: { applied: 0, heldByAuthor: [pendingSpeech] } });
  });

  it('applies a pending studio proposal and settles its turn', async () => {
    const applied: string[] = [];
    const applier = {
      apply: async (_root: unknown, entity: { key: string }, turn: { id: string }) => {
        applied.push(`${entity.key}:${turn.id}`);
        return { status: 'applied', message: '적용됨' };
      },
    } as unknown as StudioProposalApplier;
    const store = new SessionStore(await caches.open(root()));
    store.save({
      id: 'studio-1',
      kind: 'studio',
      elementId: eliaId,
      openedAt: '2026-11-01T00:00:00.000Z',
      pendingCount: 1,
      data: {
        version: '2.0.0',
        id: 'studio-1',
        entity: { kind: 'character', key: 'elia' },
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z',
        title: '말투',
        hasAppliedChanges: false,
        turns: [
          { id: 'u1', role: 'user', text: '말투를 퉁명스럽게' },
          {
            id: 'p1',
            role: 'assistant',
            kind: 'proposal',
            summary: '말투 변경',
            targetFile: 'character/elia.card',
            patch: { target: 'card', changes: [{ field: 'role', value: 'supporting' }] },
            baselineHash: 'sha256:x',
            validation: { state: 'pass', warnings: [] },
            status: 'pending',
          },
        ],
      },
    });

    const result = await new CardPendingChangesDesk({ cards, caches, applier }).apply(root(), 'elia');

    expect(result).toMatchObject({ ok: true, report: { applied: 1, failures: [] } });
    expect(applied).toEqual(['elia:p1']);
    const settled = store.find('studio-1');
    expect(settled?.pendingCount).toBe(0);
    expect(JSON.stringify(settled?.data)).toContain('"status":"applied"');
  });
});
