export type PromptVariantId = 'generic' | 'xs' | 'rich';

export interface PromptArtifact {
  readonly system: string;
  readonly user: string;
}

export interface PromptConfig {
  readonly temperature: number;
  readonly maxTokens: number;
}
