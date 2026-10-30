import { describe, expect, it, vi } from 'vitest';

import { DraftManager, type DraftManagerDependencies } from '@storyboard/story-app';
import type { GenerateDraftRequest, GenerateDraftResult } from '@storyboard/story-engine';
import { NodeUri, type StoryUri } from '@storyboard/story-model';

const sceneUri: StoryUri = NodeUri.file('/ws/scene/01-first.card');
const draftUri: StoryUri = NodeUri.file('/ws/draft/01-first.md');
const revision = { passed: true, revisionCount: 1, remainingBlocking: 0, cancelled: false };

function createManager(generation: GenerateDraftResult, events: string[]): DraftManager {
  return new DraftManager({
    generateDraftUseCase: {
      execute: vi.fn(async (request: GenerateDraftRequest) => {
        events.push(`generate ${Object.keys(request).sort().join(',')}`);
        return generation;
      }),
    },
    reviseAfterGenerateGate: {
      maybeRunAfterGenerate: vi.fn(async (uri: StoryUri, hooks: { shouldCancel?: () => boolean }) => {
        events.push(`revise ${uri.path} cancel=${String(hooks.shouldCancel?.())}`);
        return revision;
      }),
    },
  } as unknown as DraftManagerDependencies);
}

describe('DraftManager.generateAndRevise', () => {
  it('shows the new draft, then reviews it with the same cancel signal', async () => {
    const events: string[] = [];
    const manager = createManager(
      { ok: true, kind: 'generated', draftUri, warnings: [] },
      events,
    );

    const result = await manager.generateAndRevise({
      sceneUri,
      force: true,
      isReviseAllowed: true,
      shouldCancel: () => false,
      onDraftReady: (draft) => {
        events.push(`ready ${draft.draftUri.path}`);
      },
    });

    expect(events).toEqual([
      'generate force,sceneUri,shouldCancel',
      'ready /ws/draft/01-first.md',
      'revise /ws/scene/01-first.card cancel=false',
    ]);
    expect(result.revision).toBe(revision);
  });

  it('does not review when the caller declines', async () => {
    const events: string[] = [];
    const manager = createManager(
      { ok: true, kind: 'generated', draftUri, warnings: [] },
      events,
    );

    const result = await manager.generateAndRevise({ sceneUri, isReviseAllowed: false });

    expect(events).toEqual(['generate sceneUri']);
    expect(result.revision).toBeUndefined();
  });

  it('shows a cached draft without reviewing it again', async () => {
    const events: string[] = [];
    const manager = createManager({ ok: true, kind: 'cache_hit', draftUri }, events);

    const result = await manager.generateAndRevise({
      sceneUri,
      isReviseAllowed: true,
      onDraftReady: () => {
        events.push('ready');
      },
    });

    expect(events).toEqual(['generate sceneUri', 'ready']);
    expect(result.revision).toBeUndefined();
  });

  it('neither shows nor reviews a failed generation', async () => {
    const events: string[] = [];
    const manager = createManager({ ok: false, kind: 'failed', message: '실패' }, events);

    const result = await manager.generateAndRevise({
      sceneUri,
      isReviseAllowed: true,
      onDraftReady: () => {
        events.push('ready');
      },
    });

    expect(events).toEqual(['generate sceneUri']);
    expect(result.generation.ok).toBe(false);
  });
});
