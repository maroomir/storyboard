import type { AiProviderId } from '@storyboard/story-model';
import type { GenerateTextOptions } from '@storyboard/story-ai';
import {
  SceneGenerationPipelineCancelledError,
  type SceneGenerationPipelineTaskProviders,
} from './sceneGenerationTypes';

export function buildGenerateOptions(
  providers: Readonly<SceneGenerationPipelineTaskProviders> | undefined,
  task: keyof SceneGenerationPipelineTaskProviders,
): GenerateTextOptions | undefined {
  const providerId: AiProviderId | undefined = providers?.[task];
  return providerId ? { providerId } : undefined;
}

export function withAttribution(
  options: GenerateTextOptions | undefined,
  attribution: GenerateTextOptions['attribution'],
): GenerateTextOptions {
  return { ...options, attribution };
}

export function assertNotCancelled(shouldCancel: (() => boolean) | undefined): void {
  if (shouldCancel?.()) {
    throw new SceneGenerationPipelineCancelledError();
  }
}
