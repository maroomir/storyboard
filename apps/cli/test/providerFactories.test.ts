import { describe, expect, it } from 'vitest';

import { aiProviderIds } from '@storyboard/story-model';
import { createAiProviderRegistry, registeredProviderIds } from '@storyboard/story-ai';

describe('provider factories', () => {
  it('registers a factory for every provider in the catalog once the registry is loaded', () => {
    expect(typeof createAiProviderRegistry).toBe('function');
    expect([...registeredProviderIds()].sort()).toEqual([...aiProviderIds].sort());
  });
});
