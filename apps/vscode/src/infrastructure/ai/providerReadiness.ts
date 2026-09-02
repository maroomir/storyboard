import type { AiTaskName, ConfigBridge } from '@storyboard/story-ai';

// Background features (inline completion, on-save diagnostics) must stay quiet until the author
// has chosen a provider; only an explicit command should surface the "choose one" prompt.
export function isTaskProviderReady(configBridge: ConfigBridge, taskName: AiTaskName): boolean {
  return (
    configBridge.getTaskProviderOverride(taskName) !== null ||
    configBridge.isDefaultProviderConfigured()
  );
}
