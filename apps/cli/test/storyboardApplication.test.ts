import { describe, expect, it, vi } from 'vitest';

import { StoryboardApplication } from '@storyboard/story-app';
import { ConfigBridge, SecretStore } from '@storyboard/story-ai';
import { NodeUri } from '@storyboard/story-format';
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
  it('builds every shared service from the host adapters alone', () => {
    const { services } = createApplication();

    for (const [name, service] of Object.entries(services)) {
      expect(service, name).toBeDefined();
    }
    expect(services.generateAllDraftsUseCase).toBeInstanceOf(Object);
    expect(services.novelPipeline).toBeInstanceOf(Object);
  });

  it('can be disposed twice without throwing', () => {
    const app = createApplication();

    app.dispose();

    expect(() => app.dispose()).not.toThrow();
  });
});
