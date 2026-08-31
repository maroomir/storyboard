import * as vscode from 'vscode';
import { describe, expect, it, vi } from 'vitest';

import { CondenseDraftUseCase } from '@storyboard/story-engine';

function createUseCase(result: string): {
  readonly condenseDraft: ReturnType<typeof vi.fn>;
  readonly useCase: CondenseDraftUseCase;
} {
  const condenseDraft = vi.fn(async (): Promise<string> => result);
  const aiGateway = {
    createService: (): { readonly condenseDraft: typeof condenseDraft } => ({ condenseDraft }),
    getTaskProvider: (): string => 'mock',
  };
  const logger = { error: vi.fn() };

  return { condenseDraft, useCase: new CondenseDraftUseCase(aiGateway as never, logger as never) };
}

const body = '가'.repeat(600);

describe('CondenseDraftUseCase', () => {
  it('asks the revision provider for the configured target length', async () => {
    const { condenseDraft, useCase } = createUseCase('나'.repeat(300));

    const result = await useCase.execute({
      workspaceRoot: vscode.Uri.file('/workspace'),
      sceneStem: '01-scene',
      format: 'novel',
      body,
      maxCompressionPercent: 50,
    });

    expect(result).toEqual({ kind: 'condensed', ok: true, text: '나'.repeat(300) });
    expect(condenseDraft).toHaveBeenCalledWith(
      expect.objectContaining({ body, targetLength: 300 }),
      expect.objectContaining({ providerId: 'mock' }),
    );
  });

  it('rejects a result that does not shorten the original', async () => {
    const { useCase } = createUseCase('나'.repeat(600));

    await expect(
      useCase.execute({
        workspaceRoot: vscode.Uri.file('/workspace'),
        sceneStem: '01-scene',
        format: 'novel',
        body,
        maxCompressionPercent: 50,
      }),
    ).resolves.toMatchObject({ kind: 'rejected', reason: 'not-shorter', ok: false });
  });

  it('returns an undersized body for explicit diff review', async () => {
    const { useCase } = createUseCase('나'.repeat(299));

    await expect(
      useCase.execute({
        workspaceRoot: vscode.Uri.file('/workspace'),
        sceneStem: '01-scene',
        format: 'novel',
        body,
        maxCompressionPercent: 50,
      }),
    ).resolves.toEqual({
      kind: 'review-required',
      ok: true,
      text: '나'.repeat(299),
      candidateLength: 299,
      minimumLength: 300,
    });
  });

  it('still rejects empty and meta responses without a review candidate', async () => {
    const empty = createUseCase('');
    const meta = createUseCase('다음과 같이 축소했습니다.');

    await expect(
      empty.useCase.execute({
        workspaceRoot: vscode.Uri.file('/workspace'),
        sceneStem: '01-scene',
        format: 'novel',
        body,
        maxCompressionPercent: 50,
      }),
    ).resolves.toMatchObject({ kind: 'rejected', reason: 'empty', ok: false });
    await expect(
      meta.useCase.execute({
        workspaceRoot: vscode.Uri.file('/workspace'),
        sceneStem: '01-scene',
        format: 'novel',
        body,
        maxCompressionPercent: 50,
      }),
    ).resolves.toMatchObject({ kind: 'rejected', reason: 'meta-response', ok: false });
  });
});
