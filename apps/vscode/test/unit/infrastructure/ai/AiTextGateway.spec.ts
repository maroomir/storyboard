import { describe, expect, it, vi } from 'vitest';

import { AiTextGateway, type AiProviderRegistry } from '@storyboard/story-ai';
import { AiProviderError, type AiGenerateResponse, type UsageRecord } from '@storyboard/story-model';

const response: AiGenerateResponse = {
  text: '본문',
  providerId: 'claude-code',
  model: 'claude-opus-5-5',
  usage: { inputTokens: 1, outputTokens: 1 },
} as AiGenerateResponse;

function timeout(): AiProviderError {
  return new AiProviderError('cli-timeout', 'claude-code', '시간 안에 끝나지 않아 중단했습니다.');
}

function createGateway(
  generate: () => Promise<AiGenerateResponse>,
  usage: UsageRecord[] = [],
): AiTextGateway {
  const registry: AiProviderRegistry = {
    generate: vi.fn(generate),
    generateWithProvider: vi.fn(generate),
  } as unknown as AiProviderRegistry;

  return new AiTextGateway(registry, { onUsage: (record: UsageRecord): void => void usage.push(record) });
}

describe('AiTextGateway', () => {
  it('sends a call that timed out once more and keeps the second answer', async () => {
    const generate = vi.fn<() => Promise<AiGenerateResponse>>()
      .mockRejectedValueOnce(timeout())
      .mockResolvedValueOnce(response);
    const usage: UsageRecord[] = [];

    await expect(
      createGateway(generate, usage).generate('sceneBeats', [], {}),
    ).resolves.toBe(response);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(usage).toHaveLength(1);
  });

  it('gives up after the second time-out with the provider error', async () => {
    const generate = vi.fn<() => Promise<AiGenerateResponse>>().mockRejectedValue(timeout());

    await expect(createGateway(generate).generate('sceneBeats', [], {})).rejects.toMatchObject({
      code: 'cli-timeout',
    });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it.each(['cli-usage-limit', 'usage-limit', 'generation-failed'] as const)(
    'does not send a call again after %s',
    async (code) => {
      const generate = vi
        .fn<() => Promise<AiGenerateResponse>>()
        .mockRejectedValue(new AiProviderError(code, 'claude-code', '실패'));

      await expect(createGateway(generate).generate('sceneBeats', [], {})).rejects.toMatchObject({
        code,
      });
      expect(generate).toHaveBeenCalledTimes(1);
    },
  );

  it('does not send a cancelled call again', async () => {
    const aborted: Error = new Error('aborted');
    const generate = vi.fn<() => Promise<AiGenerateResponse>>().mockRejectedValue(aborted);

    await expect(createGateway(generate).generate('sceneBeats', [], {})).rejects.toBe(aborted);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
