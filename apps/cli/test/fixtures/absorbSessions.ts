import { SessionStore, type WorkspaceCaches } from '@storyboard/story-engine';
import { NodeUri, readPendingStatements, type Statement } from '@storyboard/story-model';

import { createWorkspaceCaches, createWorkspaceCards } from './workspaceCacheFixture';

export interface AbsorbSessionSnapshot {
  readonly location?: string;
  readonly bundle?: unknown;
  readonly plan?: unknown;
  readonly responses?: unknown;
  readonly synopsisCandidate?: string;
}

async function withCaches<TResult>(run: (caches: WorkspaceCaches) => Promise<TResult>): Promise<TResult> {
  const caches: WorkspaceCaches = createWorkspaceCaches();
  try {
    return await run(caches);
  } finally {
    await caches.closeAll();
  }
}

export async function readAbsorbSessions(workspace: string): Promise<readonly AbsorbSessionSnapshot[]> {
  return await withCaches(async (caches) =>
    new SessionStore(await caches.open(NodeUri.file(workspace)))
      .listByKind('absorb')
      .filter((record) => record.elementId === undefined)
      .map((record) => record.data as AbsorbSessionSnapshot),
  );
}

export async function readAbsorbPending(workspace: string, slug: string): Promise<readonly Statement[]> {
  return await withCaches(async (caches) => {
    const root: NodeUri = NodeUri.file(workspace);
    const bundle = await createWorkspaceCards(caches).findBundleBySlug(root, slug);
    if (bundle === undefined) {
      return [];
    }
    return new SessionStore(await caches.open(root))
      .listForElement(bundle.header.id)
      .filter((record) => record.kind === 'absorb')
      .flatMap((record) => readPendingStatements(record.data));
  });
}
