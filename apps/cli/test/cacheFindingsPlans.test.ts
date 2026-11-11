import { afterEach, describe, expect, it } from 'vitest';

import {
  ChapterSummaryStore,
  FindingStore,
  RevisionPlanRecorder,
  RevisionPlanStore,
  type WorkspaceCaches,
} from '@storyboard/story-engine';
import {
  createEmptyRevisionPlan,
  NodeUri,
  upsertRevisionEntry,
  type RevisionPlan,
} from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

import { TemporaryWorkspaces } from './fixtures/cacheWorkspace';
import { createWorkspaceCaches } from './fixtures/workspaceCacheFixture';

const workspaces: TemporaryWorkspaces = new TemporaryWorkspaces();
const rooftop = 'c2e8a1b4-9d7c-4e3f-a2b1-0c9d8e7f6a5b';
const school = '5a70c1d2-3e4f-4a5b-9c6d-7e8f9a0b1c2d';

afterEach(() => workspaces.cleanUp());

describe('finding store', () => {
  it('keeps one finding per kind and subject and hands it back only while its input holds', async () => {
    const findings: FindingStore = new FindingStore(await workspaces.openFreshCache());
    findings.record({ kind: 'background-conflict', subject: rooftop, inputHash: 'sha256:aa', data: [] });
    findings.record({ kind: 'background-conflict', subject: school, inputHash: 'sha256:bb', data: [] });
    findings.record({ kind: 'background-conflict', subject: rooftop, inputHash: 'sha256:cc', data: [{ items: ['가', '나'] }] });

    expect(findings.list('background-conflict').map((finding) => finding.subject)).toEqual([rooftop, school].sort());
    expect(findings.findCurrent('background-conflict', rooftop, 'sha256:aa')).toBeUndefined();
    expect(findings.findCurrent('background-conflict', rooftop, 'sha256:cc')?.data).toEqual([{ items: ['가', '나'] }]);
    findings.remove('background-conflict', school);
    expect(findings.list('background-conflict').map((finding) => finding.subject)).toEqual([rooftop]);
  });
});

describe('chapter summary store', () => {
  it('keeps a summary per thread and chapter and names the chapters it lacks', async () => {
    const summaries: ChapterSummaryStore = new ChapterSummaryStore(await workspaces.openFreshCache());
    summaries.save({ threadId: 'main', chapterId: 'chapter-1', inputHash: 'sha256:aa', summary: '전학 첫날' });
    summaries.save({ threadId: 'jun', chapterId: 'chapter-1', inputHash: 'sha256:bb', summary: '준의 편지' });
    summaries.save({ threadId: 'main', chapterId: 'chapter-1', inputHash: 'sha256:cc', summary: '전학 첫날, 다시' });

    expect(summaries.find('main', 'chapter-1')).toMatchObject({ inputHash: 'sha256:cc', summary: '전학 첫날, 다시' });
    expect(summaries.listMissing('main', ['chapter-1', 'chapter-2', 'chapter-3'])).toEqual(['chapter-2', 'chapter-3']);
    summaries.remove('jun', 'chapter-1');
    expect(summaries.listThread('jun')).toEqual([]);
  });
});

describe('revision plan store', () => {
  it('hands back the last plan without calling a model', async () => {
    const workspace: string = workspaces.create();
    const plans: RevisionPlanStore = new RevisionPlanStore(await workspaces.openCache(workspace));
    const plan: RevisionPlan = upsertRevisionEntry(createEmptyRevisionPlan(), {
      sceneStem: '002-rooftop',
      checkedAt: '2026-11-11T00:00:00.000Z',
      revisionCount: 1,
      remainingBlocking: 0,
      instructions: ['반복되는 입버릇을 줄인다'],
    });
    plans.save(createEmptyRevisionPlan());
    plans.save(plan);

    const reopened: RevisionPlanStore = new RevisionPlanStore(await workspaces.openCache(workspace));

    expect(reopened.findLatest()?.plan).toEqual(plan);
  });

  it('has no plan before the first review', async () => {
    expect(new RevisionPlanStore(await workspaces.openFreshCache()).findLatest()).toBeUndefined();
  });
});

describe('revision plan recorder', () => {
  it('folds each reviewed scene into the one latest plan', async () => {
    const workspace: string = workspaces.create();
    const caches: WorkspaceCaches = createWorkspaceCaches();
    const recorder: RevisionPlanRecorder = new RevisionPlanRecorder({
      fileSystem: new NodeFileSystem(),
      caches,
    });
    const root: NodeUri = NodeUri.file(workspace);
    const entry = (sceneStem: string, remainingBlocking: number) => ({
      sceneStem,
      checkedAt: '2026-11-11T00:00:00.000Z',
      revisionCount: 1,
      remainingBlocking,
      instructions: [],
    });

    await recorder.recordEntry(root, entry('001-arrival', 2));
    await recorder.recordEntry(root, entry('002-rooftop', 0));
    await recorder.recordEntry(root, entry('001-arrival', 0));

    const latest = await recorder.readLatest(root);
    const database = await caches.open(root);
    expect(latest?.plan.entries.map((item) => [item.sceneStem, item.remainingBlocking])).toEqual([
      ['001-arrival', 0],
      ['002-rooftop', 0],
    ]);
    expect(database.all('SELECT id FROM revision_plans')).toHaveLength(1);
    await caches.closeAll();
  });
});

