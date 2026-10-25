import { readEnabledHiddenProviderIds } from '@storyboard/story-config';
import { listAvailableProviderIds, type AiProviderId } from '@storyboard/story-model';

import { resolveCliPaths } from './paths';

export function enabledHiddenProviderIds(env: NodeJS.ProcessEnv = process.env): AiProviderId[] {
  return readEnabledHiddenProviderIds(resolveCliPaths(env).configFile);
}

export function availableProviderIds(env: NodeJS.ProcessEnv = process.env): AiProviderId[] {
  return listAvailableProviderIds(enabledHiddenProviderIds(env));
}
