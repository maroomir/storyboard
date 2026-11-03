import * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';

import type { StoryboardCard } from '@storyboard/story-model';

import {
  CardEditorRpc,
  type CardCustomEditorDependencies,
} from '@/presentation/providers/CardCustomEditorProvider';
import { VirtualDocumentStore } from '@/presentation/providers/virtualDocumentStore';

const unsavedCardText: string = [
  'type: character',
  'id: hana',
  'name: 하나',
  'role: main',
  'traits:',
  '  - 아직 저장하지 않은 특성',
  '',
].join('\n');

const expectedCard: StoryboardCard = {
  type: 'character',
  id: 'hana',
  name: '하나',
  role: 'main',
  traits: ['아직 저장하지 않은 특성'],
};

interface Harness {
  readonly rpc: CardEditorRpc;
  readonly interviews: {
    readonly start: ReturnType<typeof vi.fn>;
    readonly next: ReturnType<typeof vi.fn>;
    readonly answer: ReturnType<typeof vi.fn>;
    readonly confirm: ReturnType<typeof vi.fn>;
    readonly finish: ReturnType<typeof vi.fn>;
  };
}

function harness(): Harness {
  const interviews = {
    start: vi.fn(async () => ({ ok: true, opening: { sessionId: 's1' } })),
    next: vi.fn(async () => undefined),
    answer: vi.fn(async () => ({ isRebuilt: false, answeredCount: 1 })),
    confirm: vi.fn(async () => undefined),
    finish: vi.fn(async () => ({ sessionId: 's1', cardId: 'hana', answered: 0, skipped: 0, candidateCount: 0, undecidedAxisLabels: [] })),
  };
  const document = {
    uri: vscode.Uri.file('/ws/character/renamed-on-disk.card'),
    getText: (): string => unsavedCardText,
  } as unknown as vscode.TextDocument;
  const dependencies = { interviews } as unknown as CardCustomEditorDependencies;

  return { rpc: new CardEditorRpc(document, dependencies, new VirtualDocumentStore()), interviews };
}

describe('card editor interview rpc', () => {
  it('interviews the card in the editor document, not the file on disk', async () => {
    const { rpc, interviews } = harness();
    const handlers = rpc.handlers();
    const uri: string = 'file:///ws/character/renamed-on-disk.card';

    await handlers['interviews.start']({ uri });
    await handlers['interviews.next']({ uri, sessionId: 's1' });
    await handlers['interviews.answer']({ uri, sessionId: 's1', questionId: 'q1', answer: { kind: 'skipped' } });
    await handlers['interviews.confirm']({ uri, sessionId: 's1', questionId: 'q1', confirmation: { kind: 'value', valueId: 'counter' } });
    await handlers['interviews.finish']({ uri, sessionId: 's1' });

    for (const step of [interviews.start, interviews.next, interviews.answer, interviews.confirm, interviews.finish]) {
      expect(step).toHaveBeenCalledTimes(1);
      expect(step.mock.calls[0]?.[0]).toMatchObject({ cardId: 'hana', card: expectedCard });
    }
  });
});
