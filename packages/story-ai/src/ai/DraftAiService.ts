import type { GenerateTextOptions } from './aiServiceTypes';

export interface ContinuityCheckOptions extends GenerateTextOptions {
  readonly hasSceneMarkers?: boolean;
}
import { AiTextGateway } from './AiTextGateway';
import {
  toContinuityIssue,
  toGrammarIssue,
  toPromptMessages,
  type ContinuityIssue,
  type GrammarIssue,
} from './aiResponseCoercion';
import { ContinuityCheckPrompt } from './prompts/continuityCheck';
import { DraftAugmentPrompt, type DraftAugmentInput } from './prompts/draftAugment';
import { DraftCritiquePrompt, type DraftCritiqueInput } from './prompts/draftCritique';
import { DraftCondensePrompt, type DraftCondenseInput } from './prompts/draftCondense';
import { DraftExpansionPrompt } from './prompts/draftExpansion';
import { DraftRevisionPrompt, type DraftRevisionInput } from './prompts/draftRevision';
import { GrammarCheckPrompt } from './prompts/grammarCheck';
import { InlineCompletionPrompt } from './prompts/inlineCompletion';
import { SceneCoveragePrompt } from './prompts/sceneCoverage';
import { StoryStateUpdatePrompt, type StoryStateUpdateInput } from './prompts/storyStateUpdate';
import type { PromptArtifact, PromptConfig, PromptVariantId } from './prompts/types';
import type { AiGenerateResponse, AiTaskName } from '@storyboard/story-model';
import {
  coerceCritiqueIssues,
  type DraftCritiqueIssue,
  coerceSceneCoverage,
  type SceneCoverageIssue,
  coerceStoryStateUpdate,
  type StoryStateUpdateItem,
  parseJsonArray,
} from '@storyboard/story-model';

export type InlineCompletionContext = {
  readonly activeCharacter?: string;
  readonly background?: string;
  readonly sceneIntent?: string;
};

export type DraftExpansionContext = {
  readonly activeCharacter?: string;
  readonly background?: string;
};

export class DraftAiService {
  public constructor(private readonly gateway: AiTextGateway) {}

  public async checkGrammar(
    body: string,
    options: GenerateTextOptions = {},
  ): Promise<GrammarIssue[]> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('grammarCheck', options);
    const prompt: PromptArtifact = GrammarCheckPrompt.build(body, variant);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'grammarCheck',
      prompt,
      GrammarCheckPrompt.config,
      options,
    );
    const parsedArray: unknown[] | null = parseJsonArray(response.text);

    return parsedArray ? parsedArray.flatMap((value) => toGrammarIssue(value)) : [];
  }

  public async checkContinuity(
    body: string,
    facts: readonly string[],
    options: ContinuityCheckOptions = {},
  ): Promise<ContinuityIssue[]> {
    if (facts.length === 0) return [];

    const variant: PromptVariantId = this.gateway.resolvePromptVariant('continuityCheck', options);
    const prompt: PromptArtifact = ContinuityCheckPrompt.build(
      body,
      facts,
      variant,
      options.hasSceneMarkers,
    );
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'continuityCheck',
      prompt,
      ContinuityCheckPrompt.config,
      options,
    );
    const parsedArray: unknown[] | null = parseJsonArray(response.text);

    return parsedArray ? parsedArray.flatMap((value) => toContinuityIssue(value)) : [];
  }

  public async checkSceneCoverage(
    beats: readonly string[],
    draft: string,
    options: GenerateTextOptions = {},
  ): Promise<SceneCoverageIssue[]> {
    if (beats.length === 0) return [];

    const variant: PromptVariantId = this.gateway.resolvePromptVariant('sceneCoverage', options);
    const prompt: PromptArtifact = SceneCoveragePrompt.build(beats, draft, variant);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'sceneCoverage',
      prompt,
      SceneCoveragePrompt.config,
      options,
    );

    return coerceSceneCoverage(response.text, beats.length);
  }

  public async updateStoryState(
    input: StoryStateUpdateInput,
    options: GenerateTextOptions = {},
  ): Promise<StoryStateUpdateItem[]> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('storyStateUpdate', options);
    const prompt: PromptArtifact = StoryStateUpdatePrompt.build(input, variant);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'storyStateUpdate',
      prompt,
      StoryStateUpdatePrompt.config,
      options,
    );

    return coerceStoryStateUpdate(response.text);
  }

  public async completeInline(
    prefix: string,
    context: InlineCompletionContext = {},
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('inlineCompletion', options);
    const prompt: PromptArtifact = InlineCompletionPrompt.build(prefix, context, variant);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'inlineCompletion',
      prompt,
      InlineCompletionPrompt.config,
      options,
    );

    return response.text.trim();
  }

  public async expandDraft(
    selection: string,
    context: DraftExpansionContext = {},
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('draftExpansion', options);
    const prompt: PromptArtifact = DraftExpansionPrompt.build(selection, context, variant);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'draftExpansion',
      prompt,
      DraftExpansionPrompt.config,
      options,
    );

    return response.text.trim();
  }

  public async critiqueDraft(
    input: DraftCritiqueInput,
    options: GenerateTextOptions = {},
  ): Promise<DraftCritiqueIssue[]> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('draftCritique', options);
    const prompt: PromptArtifact = DraftCritiquePrompt.build(input, variant);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'draftCritique',
      prompt,
      DraftCritiquePrompt.config,
      options,
    );

    return coerceCritiqueIssues(response.text);
  }

  public async reviseDraft(
    input: DraftRevisionInput,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('draftRevision', options);
    const prompt: PromptArtifact = DraftRevisionPrompt.build(input, variant);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'draftRevision',
      prompt,
      DraftRevisionPrompt.config,
      options,
    );

    return response.text.trim();
  }

  public async condenseDraft(
    input: DraftCondenseInput,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('draftRevision', options);
    const prompt: PromptArtifact = DraftCondensePrompt.build(input, variant);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'draftRevision',
      prompt,
      DraftCondensePrompt.config,
      options,
    );

    return response.text.trim();
  }

  public async augmentDraft(
    input: DraftAugmentInput,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('draftAugment', options);
    const prompt: PromptArtifact = DraftAugmentPrompt.build(input, variant, options.styleDirective);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'draftAugment',
      prompt,
      DraftAugmentPrompt.config,
      options,
    );

    return response.text.trim();
  }

  private async generateWithDefaults(
    taskName: AiTaskName,
    prompt: PromptArtifact,
    config: PromptConfig,
    options: GenerateTextOptions,
  ): Promise<AiGenerateResponse> {
    return this.gateway.generate(taskName, toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? config.temperature,
      maxTokens: options.maxTokens ?? config.maxTokens,
      reasoningEffort: options.reasoningEffort ?? config.reasoningEffort,
    });
  }
}
