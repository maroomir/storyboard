import {
  ConfigBridge,
  SecretStore,
  StoryboardAIService,
  createAiProviderRegistry,
  type StoryboardConfigurationLike,
  type StoryboardSecretStorageLike,
} from '@storyboard/story-ai';

import type { ProvidersConfig } from '../config/config';

// The extension backs these ports with VSCode SecretStorage and workspace configuration. Headless,
// they are backed by the bot's own config file, so both apps drive the identical AI engine.
class InMemorySecretStorage implements StoryboardSecretStorageLike {
  private readonly values = new Map<string, string>();

  public constructor(seed: Readonly<Record<string, string>> = {}) {
    for (const [key, value] of Object.entries(seed)) {
      this.values.set(key, value);
    }
  }

  public get(key: string): PromiseLike<string | undefined> {
    return Promise.resolve(this.values.get(key));
  }

  public store(key: string, value: string): PromiseLike<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  public delete(key: string): PromiseLike<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

// Flattens the bot's `providers` block into the same `storyboard.*` setting keys the extension
// exposes, so ConfigBridge needs no bot-specific branch.
function createConfiguration(providers: ProvidersConfig | undefined): StoryboardConfigurationLike {
  const settings = new Map<string, unknown>();

  settings.set('defaultProvider', providers?.default ?? 'mock');
  settings.set('tasks', providers?.tasks ?? {});

  for (const [providerId, section] of Object.entries(providers?.models ?? {})) {
    if (section.model !== undefined) {
      settings.set(`providers.${providerId}.model`, section.model);
    }
    if (section.command !== undefined) {
      settings.set(`providers.${providerId}.command`, section.command);
    }
    if (section.timeoutMs !== undefined) {
      settings.set(`providers.${providerId}.timeoutMs`, section.timeoutMs);
    }
    if (section.reasoningEffort !== undefined) {
      settings.set(`providers.${providerId}.reasoningEffort`, section.reasoningEffort);
    }
  }

  return {
    get: <T>(section: string, defaultValue: T): T => (settings.get(section) as T) ?? defaultValue,
  };
}

export interface AiGatewayOptions {
  readonly providers: ProvidersConfig | undefined;
  readonly apiKeys?: Readonly<Record<string, string>>;
}

export function createAiService(options: AiGatewayOptions): StoryboardAIService {
  const configuration = createConfiguration(options.providers);
  const registry = createAiProviderRegistry({
    secretStore: new SecretStore(new InMemorySecretStorage(options.apiKeys)),
    configBridge: new ConfigBridge({ getConfiguration: () => configuration }),
  });

  return new StoryboardAIService(registry);
}
