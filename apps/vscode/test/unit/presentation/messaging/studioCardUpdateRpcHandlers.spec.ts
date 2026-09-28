import * as vscode from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStudioCardUpdateRpcHandlers } from '@/presentation/messaging/studioCardUpdateRpcHandlers';
import type { StudioCardUpdateRpcHandlersDependencies } from '@/presentation/messaging/studioCardUpdateRpcHandlers';

const description = '정난정 조선 중기의 인물. 윤원형의 첩으로 막대한 부와 영향력을 누렸다.';

interface Harness {
  readonly handlers: ReturnType<typeof createStudioCardUpdateRpcHandlers>;
  readonly seed: ReturnType<typeof vi.fn>;
  readonly written: unknown[];
  readonly exists: ReturnType<typeof vi.fn>;
}

let shownDocuments: string[];

beforeEach((): void => {
  shownDocuments = [];
  // NOTE: the shared vscode mock has no showTextDocument, so it is installed by hand.
  (vscode.window as { showTextDocument?: unknown }).showTextDocument = async (
    uri: vscode.Uri,
  ): Promise<undefined> => {
    shownDocuments.push(String(uri.fsPath));
    return undefined;
  };
});

afterEach((): void => {
  delete (vscode.window as { showTextDocument?: unknown }).showTextDocument;
  vi.restoreAllMocks();
});

function harness(): Harness {
  const seed = vi.fn(async () => ({ kind: 'character', name: '정난정', id: 'jeong-nan-jeong' }));
  const exists = vi.fn(async () => false);
  const written: unknown[] = [];

  const deps = {
    aiGateway: {
      createService: () => ({ extractStudioCardSeed: seed }),
      getTaskProvider: () => 'mock',
    },
    cards: {
      exists,
      write: vi.fn(async (_root: unknown, card: unknown) => {
        written.push(card);
        const id = (card as { id: string }).id;
        return vscode.Uri.file(`/workspace/character/${id}.card`);
      }),
    },
    logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    getProjectRoot: async () => vscode.Uri.file('/workspace'),
  } as unknown as StudioCardUpdateRpcHandlersDependencies;

  return { handlers: createStudioCardUpdateRpcHandlers(deps), seed, written, exists };
}

async function create(h: Harness, text = description): Promise<Record<string, unknown>> {
  const handler = h.handlers['studio.card.update'] as (
    payload: unknown,
  ) => Promise<Record<string, unknown>>;

  return handler({ description: text });
}

describe('studio.card.update', () => {
  it('creates an empty card, opens it and stages the fill instruction', async () => {
    const h = harness();

    const response = await create(h);

    expect(response.ok).toBe(true);
    expect(h.written).toHaveLength(1);
    expect(h.written[0]).toMatchObject({
      type: 'character',
      id: 'jeong-nan-jeong',
      name: '정난정',
    });
    expect(shownDocuments[0]).toContain('jeong-nan-jeong.card');
    expect(String(response.instruction)).toContain('이 설명으로 카드를 채워줘');
    expect(String(response.instruction)).toContain('정난정');
  });

  it('creates a background card when the seed says so', async () => {
    const h = harness();
    h.seed.mockResolvedValue({ kind: 'background', name: '수길당', id: 'sugildang' });

    const response = await create(h);

    expect(response.ok).toBe(true);
    expect(h.written[0]).toMatchObject({ type: 'location', id: 'sugildang' });
    expect(String(response.message)).toContain('background/sugildang.card');
  });

  it('opens the existing card instead of minting a duplicate', async () => {
    const h = harness();
    h.exists.mockResolvedValue(true);

    const response = await create(h);

    expect(response.ok).toBe(true);
    expect(h.written).toHaveLength(0);
    expect(shownDocuments[0]).toContain('jeong-nan-jeong.card');
    expect(String(response.message)).toContain('이미 있어');
  });

  it('asks for a clearer description when the seed is unreadable', async () => {
    const h = harness();
    h.seed.mockResolvedValue(undefined);

    const response = await create(h);

    expect(response.ok).toBe(false);
    expect(h.written).toHaveLength(0);
    expect(String(response.message)).toContain('이름을 앞세워');
  });

  it('fails softly when the seed call throws', async () => {
    const h = harness();
    h.seed.mockRejectedValue(new Error('provider down'));

    const response = await create(h);

    expect(response.ok).toBe(false);
    expect(h.written).toHaveLength(0);
  });
});
