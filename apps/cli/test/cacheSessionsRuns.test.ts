import { afterEach, describe, expect, it } from 'vitest';

import { RunStore, SessionStore, UsageStore } from '@storyboard/story-engine';
import type { NovelRunState, UsageLedgerEntry } from '@storyboard/story-model';

import { TemporaryWorkspaces } from './fixtures/cacheWorkspace';

const workspaces: TemporaryWorkspaces = new TemporaryWorkspaces();
const elia = '3f9a2c1e-6b0d-4e7a-9c11-0d2f5a8b7e44';
const sera = '7b1d2e90-4c3a-4f1b-8d2e-5a6b7c8d9e0f';

afterEach(() => workspaces.cleanUp());

function clockFrom(start: string): () => Date {
  let tick: number = 0;
  return (): Date => new Date(Date.parse(start) + 1000 * tick++);
}

describe('session store', () => {
  it('keeps every session of a card in order until the cache is cleared', async () => {
    const workspace: string = workspaces.create();
    const sessions: SessionStore = new SessionStore(await workspaces.openCache(workspace), clockFrom('2026-11-11T00:00:00.000Z'));
    const first = sessions.open({ kind: 'studio', elementId: elia, data: { turns: ['엘리아를 만들어 줘'] } });
    sessions.close(first.id);
    const second = sessions.open({ kind: 'interview', elementId: elia, data: { answers: [] } });
    sessions.open({ kind: 'studio', elementId: sera, data: {} });

    const reopened: SessionStore = new SessionStore(await workspaces.openCache(workspace));
    const history = reopened.listForElement(elia);

    expect(history.map((session) => session.kind)).toEqual(['studio', 'interview']);
    expect(history[0]).toMatchObject({ id: first.id, data: { turns: ['엘리아를 만들어 줘'] } });
    expect(history[0]?.closedAt).toBeDefined();
    expect(reopened.findOpen('interview', elia)?.id).toBe(second.id);
    expect(reopened.findOpen('studio', elia)).toBeUndefined();
  });

  it('lists the sessions that hold proposals waiting to be applied', async () => {
    const sessions: SessionStore = new SessionStore(await workspaces.openFreshCache());
    const studio = sessions.open({ kind: 'studio', elementId: elia, data: {} });
    sessions.open({ kind: 'absorb', data: { synopsis: '후보' }, pendingCount: 1 });

    sessions.update(studio.id, { data: { pending: [{ facet: 'traits' }] }, pendingCount: 1 });

    expect(sessions.listWithPending().map((session) => session.kind).sort()).toEqual(['absorb', 'studio']);
    expect(sessions.find(studio.id)?.data).toEqual({ pending: [{ facet: 'traits' }] });
    expect(sessions.findOpen('absorb')?.elementId).toBeUndefined();
  });
});

describe('run store', () => {
  it('keeps the latest novel run in place of novel-run.json', async () => {
    const runs: RunStore = new RunStore(await workspaces.openFreshCache());
    const state: NovelRunState = {
      version: '1.0.0',
      runId: 'run-1',
      startedAt: '2026-11-11T00:00:00.000Z',
      updatedAt: '2026-11-11T00:00:00.000Z',
      runMode: 'auto',
      status: 'running',
      completedStages: ['outline'],
      nextChapterIndex: 0,
    };

    runs.saveNovelRun(state);
    runs.saveNovelRun({ ...state, status: 'paused', updatedAt: '2026-11-11T00:05:00.000Z' });

    expect(runs.findLatestNovelRun()).toMatchObject({ runId: 'run-1', status: 'paused' });
    runs.removeNovelRun('run-1');
    expect(runs.findLatestNovelRun()).toBeUndefined();
  });
});

describe('usage store', () => {
  it('records each call once and sums it by entity', async () => {
    const usage: UsageStore = new UsageStore(await workspaces.openFreshCache());
    const entry: UsageLedgerEntry = {
      id: 'u1',
      recordedAt: '2026-11-11T00:00:00.000Z',
      taskName: 'sceneDraft',
      providerId: 'claude',
      model: 'claude-sonnet-5',
      usage: { inputTokens: 1000, outputTokens: 200 },
      attribution: { primary: { kind: 'scene', id: 'rooftop' } },
    };

    expect(usage.append(entry)).toBe(true);
    expect(usage.append(entry)).toBe(false);
    expect(usage.list()).toEqual([expect.objectContaining({ id: 'u1', taskName: 'sceneDraft' })]);
    expect(usage.summarize().total.tokens).toBe(1200);
    expect(usage.summarize().scenes.rooftop?.tokens).toBe(1200);
  });
});
