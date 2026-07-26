import { describe, expect, it } from 'vitest';

import { createAiService } from '../src/ai/aiGateway';

// The point of packages/story-ai is that the bot drives the extension's AI engine unmodified. If
// the engine ever regains an editor dependency, or the ports stop being satisfiable from a plain
// config file, this fails.
describe('bot AI gateway', () => {
  it('builds the shared AI service headlessly and generates through the mock provider', async () => {
    const service = createAiService({ providers: { default: 'mock' } });

    const response = await service.generateText('sceneDraft', [
      { role: 'system', content: '너는 소설 초안을 쓴다.' },
      { role: 'user', content: '프롤로그를 써라.' },
    ]);

    expect(typeof response.text).toBe('string');
    expect(response.text.length).toBeGreaterThan(0);
  });

  it('defaults to the mock provider when no providers block is configured', async () => {
    const service = createAiService({ providers: undefined });

    const response = await service.generateText('sceneDraft', [{ role: 'user', content: '안녕' }]);

    expect(response.text.length).toBeGreaterThan(0);
  });
});
