import {
  ConfigBridge,
  SecretStore,
  StoryboardAiService,
  createAiProviderRegistry,
  type CliRunner,
  type OnUsageRecordCallback,
  type StoryboardConfigurationLike,
  type StoryboardSecretStorageLike,
} from '@storyboard/story-ai';

// The extension backs these ports with the shared ~/.storyboard files too; headless, the secret
// store stays in memory because the bot runs CLI providers that hold their own login.
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

export interface AiGatewayOptions {
  // The shared config layers (see config/sharedConfig.ts); tests hand in a plain map.
  readonly configuration: StoryboardConfigurationLike;
  readonly apiKeys?: Readonly<Record<string, string>>;
  readonly cliRunner?: CliRunner;
  readonly onUsage?: OnUsageRecordCallback;
  // A queued job has nobody to pick a provider for it, so an unconfigured one is refused.
  readonly requireConfiguredProvider?: boolean;
}

export interface AiEngine {
  readonly service: StoryboardAiService;
  readonly registry: ReturnType<typeof createAiProviderRegistry>;
  readonly configBridge: ConfigBridge;
}

export function createAiEngine(options: AiGatewayOptions): AiEngine {
  const configBridge = new ConfigBridge({ getConfiguration: () => options.configuration });
  const registry = createAiProviderRegistry({
    secretStore: new SecretStore(new InMemorySecretStorage(options.apiKeys)),
    configBridge,
    requireConfiguredProvider: options.requireConfiguredProvider ?? true,
    ...(options.cliRunner ? { createCliRunner: (): CliRunner => options.cliRunner! } : {}),
  });

  const service = options.onUsage
    ? new StoryboardAiService(registry, { onUsage: options.onUsage })
    : new StoryboardAiService(registry);

  return { service, registry, configBridge };
}

export function createAiService(options: AiGatewayOptions): StoryboardAiService {
  return createAiEngine(options).service;
}
