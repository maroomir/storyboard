import {
  parseJsonObject,
  type AiGenerateResponse,
  type AiTaskName,
  type InterviewAxis,
} from '@storyboard/story-model';

import type { AiTextGateway } from '#ai/ai/AiTextGateway';
import { toPromptMessages } from '#ai/ai/aiResponseCoercion';
import type { GenerateTextOptions } from '#ai/ai/aiServiceTypes';
import {
  InterviewAxesPrompt,
  coerceInterviewAxes,
  type InterviewAxesInput,
} from '#ai/ai/prompts/interviewAxes';
import {
  InterviewDistillPrompt,
  coerceInterviewDistill,
  type InterviewDistillDraft,
  type InterviewDistillInput,
} from '#ai/ai/prompts/interviewDistill';
import {
  InterviewQuestionPrompt,
  coerceInterviewQuestion,
  type InterviewQuestionDraft,
  type InterviewQuestionInput,
} from '#ai/ai/prompts/interviewQuestion';
import {
  InterviewRelationSpeechPrompt,
  coerceInterviewRelationSpeech,
  type InterviewRelationSpeechQuestion,
  type InterviewRelationSpeechInput,
} from '#ai/ai/prompts/interviewRelationSpeech';
import {
  InterviewUpdatePrompt,
  coerceInterviewUpdate,
  type InterviewUpdateDraft,
  type InterviewUpdateInput,
} from '#ai/ai/prompts/interviewUpdate';
import type { PromptArtifact, PromptConfig, PromptVariantId } from '#ai/ai/prompts/types';

export class InterviewAiService {
  public constructor(private readonly gateway: AiTextGateway) {}

  public async proposeInterviewAxes(
    input: InterviewAxesInput,
    options: GenerateTextOptions = {},
  ): Promise<InterviewAxis[]> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('interviewAxes', options);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'interviewAxes',
      InterviewAxesPrompt.build(input, variant),
      InterviewAxesPrompt.config,
      options,
    );

    return coerceInterviewAxes(parseJsonObject(response.text));
  }

  public async askInterviewQuestion(
    input: InterviewQuestionInput,
    options: GenerateTextOptions = {},
  ): Promise<InterviewQuestionDraft | undefined> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('interviewQuestion', options);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'interviewQuestion',
      InterviewQuestionPrompt.build(input, variant),
      InterviewQuestionPrompt.config,
      options,
    );

    return coerceInterviewQuestion(parseJsonObject(response.text), input.axes);
  }

  public async updateInterviewModel(
    input: InterviewUpdateInput,
    options: GenerateTextOptions = {},
  ): Promise<InterviewUpdateDraft | undefined> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('interviewUpdate', options);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'interviewUpdate',
      InterviewUpdatePrompt.build(input, variant),
      InterviewUpdatePrompt.config,
      options,
    );

    return coerceInterviewUpdate(parseJsonObject(response.text), input.axis);
  }

  public async distillInterview(
    input: InterviewDistillInput,
    options: GenerateTextOptions = {},
  ): Promise<InterviewDistillDraft> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('interviewDistill', options);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'interviewDistill',
      InterviewDistillPrompt.build(input, variant),
      InterviewDistillPrompt.config,
      options,
    );

    return coerceInterviewDistill(parseJsonObject(response.text), input.relationTargets);
  }

  public async askRelationSpeech(
    input: InterviewRelationSpeechInput,
    options: GenerateTextOptions = {},
  ): Promise<InterviewRelationSpeechQuestion | undefined> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant(
      'interviewRelationSpeech',
      options,
    );
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'interviewRelationSpeech',
      InterviewRelationSpeechPrompt.build(input, variant),
      InterviewRelationSpeechPrompt.config,
      options,
    );

    return coerceInterviewRelationSpeech(parseJsonObject(response.text));
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
