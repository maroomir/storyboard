import type { GenerateTextOptions } from './aiServiceTypes';
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
import type { PromptArtifact, PromptConfig } from './prompts/types';
import type { AiGenerateResponse, WiredAiTaskName } from '../contracts/aiTypes';
import { coerceCritiqueIssues, type DraftCritiqueIssue } from '../contracts/draftReview';
import { coerceSceneCoverage, type SceneCoverageIssue } from '../contracts/sceneCoverage';
import { parseJsonArray } from '../contracts/aiResponseParser';

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
    const variant = this.gateway.resolvePromptVariant('grammarCheck', options);
    const prompt = GrammarCheckPrompt.build(body, variant);
    const response = await this.generateWithDefaults(
      'grammarCheck',
      prompt,
      GrammarCheckPrompt.config,
      options,
    );
    const parsedArray = parseJsonArray(response.text);

    return parsedArray ? parsedArray.flatMap((value) => toGrammarIssue(value)) : [];
  }

  public async checkContinuity(
    body: string,
    facts: readonly string[],
    options: GenerateTextOptions = {},
  ): Promise<ContinuityIssue[]> {
    if (facts.length === 0) return [];

    const variant = this.gateway.resolvePromptVariant('continuityCheck', options);
    const prompt = ContinuityCheckPrompt.build(body, facts, variant);
    const response = await this.generateWithDefaults(
      'continuityCheck',
      prompt,
      ContinuityCheckPrompt.config,
      options,
    );
    const parsedArray = parseJsonArray(response.text);

    return parsedArray ? parsedArray.flatMap((value) => toContinuityIssue(value)) : [];
  }

  public async checkSceneCoverage(
    beats: readonly string[],
    draft: string,
    options: GenerateTextOptions = {},
  ): Promise<SceneCoverageIssue[]> {
    if (beats.length === 0) return [];

    const variant = this.gateway.resolvePromptVariant('sceneCoverage', options);
    const prompt = SceneCoveragePrompt.build(beats, draft, variant);
    const response = await this.generateWithDefaults(
      'sceneCoverage',
      prompt,
      SceneCoveragePrompt.config,
      options,
    );

    return coerceSceneCoverage(response.text, beats.length);
  }

  public async completeInline(
    prefix: string,
    context: InlineCompletionContext = {},
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant = this.gateway.resolvePromptVariant('inlineCompletion', options);
    const prompt = InlineCompletionPrompt.build(prefix, context, variant);
    const response = await this.generateWithDefaults(
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
    const variant = this.gateway.resolvePromptVariant('draftExpansion', options);
    const prompt = DraftExpansionPrompt.build(selection, context, variant);
    const response = await this.generateWithDefaults(
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
    const variant = this.gateway.resolvePromptVariant('draftCritique', options);
    const prompt = DraftCritiquePrompt.build(input, variant);
    const response = await this.generateWithDefaults(
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
    const variant = this.gateway.resolvePromptVariant('draftRevision', options);
    const prompt = DraftRevisionPrompt.build(input, variant);
    const response = await this.generateWithDefaults(
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
    const variant = this.gateway.resolvePromptVariant('draftRevision', options);
    const prompt = DraftCondensePrompt.build(input, variant);
    const response = await this.generateWithDefaults(
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
    const variant = this.gateway.resolvePromptVariant('draftAugment', options);
    const prompt = DraftAugmentPrompt.build(input, variant);
    const response = await this.generateWithDefaults(
      'draftAugment',
      prompt,
      DraftAugmentPrompt.config,
      options,
    );

    return response.text.trim();
  }

  private async generateWithDefaults(
    taskName: WiredAiTaskName,
    prompt: PromptArtifact,
    config: PromptConfig,
    options: GenerateTextOptions,
  ): Promise<AiGenerateResponse> {
    return this.gateway.generate(taskName, toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? config.temperature,
      maxTokens: options.maxTokens ?? config.maxTokens,
    });
  }
}
