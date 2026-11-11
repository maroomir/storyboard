import { InterviewRepository, SessionStore, type WorkspaceCaches } from '@storyboard/story-engine';
import {
  NodeUri,
  readPendingStatements,
  type InterviewAxesFile,
  type InterviewWorkingModel,
  type Statement,
} from '@storyboard/story-model';

import { createWorkspaceCaches, createWorkspaceCards } from './workspaceCacheFixture';

async function withInterviews<TResult>(
  run: (repository: InterviewRepository, caches: WorkspaceCaches) => Promise<TResult>,
): Promise<TResult> {
  const caches: WorkspaceCaches = createWorkspaceCaches();
  try {
    return await run(new InterviewRepository({ caches, cards: createWorkspaceCards(caches) }), caches);
  } finally {
    await caches.closeAll();
  }
}

export async function readInterviewWorkingModel(
  workspace: string,
  slug: string,
): Promise<InterviewWorkingModel | undefined> {
  return await withInterviews((repository) =>
    repository.loadWorkingModel(NodeUri.file(workspace), slug),
  );
}

export async function readInterviewAxes(workspace: string): Promise<InterviewAxesFile> {
  return await withInterviews((repository) => repository.loadAxes(NodeUri.file(workspace)));
}

export async function readInterviewPending(
  workspace: string,
  slug: string,
): Promise<readonly Statement[]> {
  return await withInterviews(async (repository, caches) => {
    const cards = createWorkspaceCards(caches);
    const roster = await cards.loadRoster(NodeUri.file(workspace), ['character', 'background']);
    const elementId: string | undefined =
      roster.lookup.idOf('character', slug) ?? roster.lookup.idOf('background', slug);
    const record = new SessionStore(await caches.open(NodeUri.file(workspace))).find(
      `interview:${elementId ?? ''}`,
    );
    return readPendingStatements(record?.data);
  });
}

export async function writeUnreadableInterviewModel(workspace: string, slug: string): Promise<void> {
  await withInterviews(async (repository, caches) => {
    const roster = await createWorkspaceCards(caches).loadRoster(NodeUri.file(workspace), ['character']);
    const elementId: string = roster.lookup.idOf('character', slug) ?? '';
    new SessionStore(await caches.open(NodeUri.file(workspace))).save({
      id: `interview:${elementId}`,
      kind: 'interview',
      elementId,
      openedAt: '2026-11-01T00:00:00.000Z',
      pendingCount: 0,
      data: { workingModel: { version: 1, records: 'broken' } },
    });
  });
}

export async function writeInterviewAxes(workspace: string, axes: InterviewAxesFile): Promise<void> {
  await withInterviews((repository) => repository.saveAxes(NodeUri.file(workspace), axes));
}
