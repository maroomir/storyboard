import type { CacheTtl, ReasoningEffort } from '@storyboard/story-model';

export type PromptVariantId = 'generic' | 'xs' | 'rich';

export const promptVariantIds: readonly [PromptVariantId, ...PromptVariantId[]] = [
  'generic',
  'xs',
  'rich',
];

export interface PromptArtifact {
  readonly system: string;
  readonly userPrefix?: string;
  readonly prefixCacheTtl?: CacheTtl;
  readonly user: string;
}

export interface PromptConfig {
  readonly temperature: number;
  readonly maxTokens: number;
  readonly reasoningEffort?: ReasoningEffort;
  readonly prefixCacheTtl?: CacheTtl;
}

export interface PromptModule<BuildParameters extends readonly unknown[]> {
  readonly config: PromptConfig;
  readonly build: (...parameters: BuildParameters) => PromptArtifact;
}
