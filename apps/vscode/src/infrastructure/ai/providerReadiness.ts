import type { AiTaskName } from '@storyboard/story-model';
import type { ConfigBridge } from '@storyboard/story-ai';

export function isTaskProviderReady(configBridge: ConfigBridge, taskName: AiTaskName): boolean {
  return (
    configBridge.getTaskProviderOverride(taskName) !== null ||
    configBridge.isDefaultProviderConfigured()
  );
}
