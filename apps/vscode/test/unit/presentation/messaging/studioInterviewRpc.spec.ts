import * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';

import type { StoryboardCard } from '@storyboard/story-model';

import { StudioInterviewRpc } from '@/presentation/messaging/studioInterviewRpcHandlers';

const workspaceRoot: vscode.Uri = vscode.Uri.file('/ws');
const hana: StoryboardCard = { type: 'character', id: 'hana', name: '하나', role: 'main' };

function harness(): {
  readonly rpc: StudioInterviewRpc;
  readonly interviews: Record<'start' | 'next' | 'answer' | 'confirm' | 'finish', ReturnType<typeof vi.fn>>;
  readonly read: ReturnType<typeof vi.fn>;
} {
  const interviews = {
    start: vi.fn(async () => ({ ok: true, opening: { sessionId: 's1' } })),
    next: vi.fn(async () => undefined),
    answer: vi.fn(async () => ({ isRebuilt: false, answeredCount: 1 })),
    confirm: vi.fn(async () => undefined),
    finish: vi.fn(async () => ({ sessionId: 's1', cardId: 'hana', answered: 0, skipped: 0, candidateCount: 0, undecidedAxisLabels: [] })),
  };
  const read = vi.fn(async (_root: unknown, slug: string) =>
    slug === 'hana' ? { category: 'character', uri: workspaceRoot, card: hana } : undefined,
  );
  const rpc = new StudioInterviewRpc({
    interviews: interviews as never,
    cards: { read } as never,
    getProjectRoot: async (): Promise<vscode.Uri> => workspaceRoot,
  });

  return { rpc, interviews, read };
}

describe('studio interview rpc', () => {
  it('interviews the card its bundle uri names, read through the card manager', async () => {
    const { rpc, interviews, read } = harness();
    const handlers = rpc.handlers();
    const uri: string = 'file:///ws/character/hana.card/card.yaml';

    await handlers['interviews.start']({ uri });
    await handlers['interviews.next']({ uri, sessionId: 's1' });
    await handlers['interviews.answer']({ uri, sessionId: 's1', questionId: 'q1', answer: { kind: 'skipped' } });
    await handlers['interviews.confirm']({ uri, sessionId: 's1', questionId: 'q1', confirmation: { kind: 'value', valueId: 'counter' } });
    await handlers['interviews.finish']({ uri, sessionId: 's1' });

    expect(read).toHaveBeenCalledWith(workspaceRoot, 'hana');
    for (const step of [interviews.start, interviews.next, interviews.answer, interviews.confirm, interviews.finish]) {
      expect(step).toHaveBeenCalledTimes(1);
      expect(step.mock.calls[0]?.[0]).toMatchObject({ workspaceRoot, cardId: 'hana', card: hana });
    }
  });

  it('refuses a card it cannot find', async () => {
    const { rpc } = harness();

    await expect(
      rpc.handlers()['interviews.start']({ uri: 'file:///ws/character/nobody.card/card.yaml' }),
    ).rejects.toThrow('인터뷰할 카드를 찾을 수 없습니다.');
  });
});
