import { describe, expect, it } from 'vitest';

import type { StoryboardConfigurationLike } from '@storyboard/story-ai';

import { createAiEngine, createAiService } from '../src/ai/aiGateway';

function configuration(values: Record<string, unknown>): StoryboardConfigurationLike {
  return {
    get: <T>(section: string, defaultValue: T): T =>
      (section in values ? values[section] : defaultValue) as T,
  };
}

// The point of packages/story-ai is that the bot drives the extension's AI engine unmodified. If
// the engine ever regains an editor dependency, or the ports stop being satisfiable from a plain
// config, this fails.
describe('bot AI gateway', () => {
  it('builds the shared AI service headlessly and generates through the mock provider', async () => {
    const service = createAiService({ configuration: configuration({ defaultProvider: 'mock' }) });

    const response = await service.generateText('sceneDraft', [
      { role: 'system', content: '너는 소설 초안을 쓴다.' },
      { role: 'user', content: '프롤로그를 써라.' },
    ]);

    expect(typeof response.text).toBe('string');
    expect(response.text.length).toBeGreaterThan(0);
  });

  // The bot holds no keys of its own: an API-key provider reads the shared secrets store, which
  // is what lets the extension's `apikey set` unlock generation here too.
  it('reads API keys through the injected shared secret storage', async () => {
    const values = new Map([['storyboard.apiKey.openai', 'sk-test']]);
    const { registry } = createAiEngine({
      configuration: configuration({ defaultProvider: 'openai' }),
      secretStorage: {
        get: async (key) => values.get(key),
        store: async (key, value) => {
          values.set(key, value);
        },
        delete: async (key) => {
          values.delete(key);
        },
      },
    });

    const statuses = await registry.listProviders();
    expect(statuses.find((status) => status.providerId === 'openai')?.hasApiKey).toBe(true);
    expect(statuses.find((status) => status.providerId === 'claude')?.hasApiKey).toBe(false);
  });

  // A queued job has nobody to pick a provider for it, so an empty config is refused instead of
  // quietly producing mock text.
  it('refuses to generate when no provider is configured anywhere', async () => {
    const service = createAiService({ configuration: configuration({}) });

    await expect(
      service.generateText('sceneDraft', [{ role: 'user', content: '안녕' }]),
    ).rejects.toMatchObject({ code: 'missing-provider' });
  });
});
