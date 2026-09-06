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
import { createFileSecretStorage, resolveStoryboardHomePaths } from '@storyboard/story-config';

export interface AiGatewayOptions {
  // The shared config layers (see config/sharedConfig.ts); tests hand in a plain map.
  readonly configuration: StoryboardConfigurationLike;
  // SECURITY: API keys come from the same 0600 ~/.storyboard/secrets.json the extension and the
  // CLI write, so the bot never holds a key of its own. Tests hand in an in-memory stand-in.
  readonly secretStorage?: StoryboardSecretStorageLike;
  readonly env?: NodeJS.ProcessEnv;
  readonly cliRunner?: CliRunner;
  readonly onUsage?: OnUsageRecordCallback;
  // A queued job has nobody to pick a provider for it, so an unconfigured one is refused.
  readonly requireConfiguredProvider?: boolean;
}

export interface AiEngine {
  readonly service: StoryboardAiService;
  readonly registry: ReturnType<typeof createAiProviderRegistry>;
  readonly configBridge: ConfigBridge;
  readonly secretStore: SecretStore;
}

export function createAiEngine(options: AiGatewayOptions): AiEngine {
  const configBridge = new ConfigBridge({ getConfiguration: () => options.configuration });
  const secretStore = new SecretStore(
    options.secretStorage ??
      createFileSecretStorage(resolveStoryboardHomePaths(options.env).secretsFile),
  );
  const registry = createAiProviderRegistry({
    secretStore,
    configBridge,
    requireConfiguredProvider: options.requireConfiguredProvider ?? true,
    ...(options.cliRunner ? { createCliRunner: (): CliRunner => options.cliRunner! } : {}),
  });

  const service = options.onUsage
    ? new StoryboardAiService(registry, { onUsage: options.onUsage })
    : new StoryboardAiService(registry);

  return { service, registry, configBridge, secretStore };
}

export function createAiService(options: AiGatewayOptions): StoryboardAiService {
  return createAiEngine(options).service;
}
