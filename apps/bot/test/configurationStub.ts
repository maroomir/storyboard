import { ConfigBridge, type StoryboardConfigurationLike } from '@storyboard/story-ai';

import type { DraftConfig, ProvidersConfig } from '../src/config/config';
import { flattenLegacyBlocks } from '../src/config/sharedConfig';

// Tests used to hand the gateway a bot.json `providers`/`draft` block; the shared config took
// that role, so the same blocks are flattened into the dotted keys it reads.
export function stubConfiguration(values: Record<string, unknown>): StoryboardConfigurationLike {
  return {
    get: <T>(section: string, defaultValue: T): T =>
      (section in values ? values[section] : defaultValue) as T,
    inspect: <T>(section: string): { globalValue?: T } =>
      section in values ? { globalValue: values[section] as T } : {},
  };
}

export function legacyConfiguration(
  providers: ProvidersConfig | undefined,
  draft?: DraftConfig,
): StoryboardConfigurationLike {
  return stubConfiguration(flattenLegacyBlocks(providers, draft));
}

export function legacyConfigBridge(
  providers: ProvidersConfig | undefined,
  draft?: DraftConfig,
): ConfigBridge {
  const configuration = legacyConfiguration(providers, draft);
  return new ConfigBridge({ getConfiguration: (): StoryboardConfigurationLike => configuration });
}
