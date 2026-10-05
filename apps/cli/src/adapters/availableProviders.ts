import { readEnabledHiddenProviderIds } from '@storyboard/story-config';
import { listAvailableProviderIds, type AiProviderId } from '@storyboard/story-model';

import { resolveCliPaths } from './paths';

export function enabledHiddenProviderIds(env: NodeJS.ProcessEnv = process.env): AiProviderId[] {
  return readEnabledHiddenProviderIds(resolveCliPaths(env).configFile);
}

// The names the CLI shows and accepts. A hidden provider the home file has not switched on is not
// a name here: help, completion and «쓸 수 있는 값» never mention it, and it is refused as unknown.
export function availableProviderIds(env: NodeJS.ProcessEnv = process.env): AiProviderId[] {
  return listAvailableProviderIds(enabledHiddenProviderIds(env));
}
