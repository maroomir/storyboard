import { describe, expect, it, vi } from 'vitest';

import { StoryboardApplication } from '@storyboard/story-app';
import { ConfigBridge, SecretStore } from '@storyboard/story-ai';
import { NodeUri } from '@storyboard/story-model';
import { NodeFileSystem, NodeWorkspaceLocator } from '@storyboard/story-node';

function createApplication(): StoryboardApplication {
  return new StoryboardApplication(
    {
      fileSystem: new NodeFileSystem(),
      workspaceLocator: new NodeWorkspaceLocator({ uri: NodeUri.file('/ws'), name: 'ws' }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), show: vi.fn() },
      secretStore: new SecretStore({
        get: async () => undefined,
        store: async () => undefined,
        delete: async () => undefined,
      }),
      configBridge: new ConfigBridge({
        getConfiguration: () => ({ get: <T>(_section: string, defaultValue: T): T => defaultValue }),
      }),
    },
    { generator: 'storyboard@0.0.0-test' },
  );
}

describe('StoryboardApplication', () => {
  it('builds every manager and infrastructure handle from the host adapters alone', () => {
    const app = createApplication();

    for (const [name, value] of Object.entries(app)) {
      expect(value, name).toBeDefined();
    }
  });

  it('exposes one manager per domain over the same graph', () => {
    const app = createApplication();

    expect(typeof app.drafts.generate).toBe('function');
    expect(typeof app.manuscript.assemble).toBe('function');
    expect(typeof app.cards.recommend).toBe('function');
    expect(typeof app.novel.run).toBe('function');
    expect(typeof app.studio.chat).toBe('function');
    expect(typeof app.novel.runState.readExisting).toBe('function');
  });

  it('can be disposed twice without throwing', () => {
    const app = createApplication();

    app.dispose();

    expect(() => app.dispose()).not.toThrow();
  });
});
