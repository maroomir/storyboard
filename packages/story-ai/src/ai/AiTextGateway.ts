import type { AiProviderRegistry } from '#ai/ai/providerRegistry';
import type {
  AiGenerateResponse,
  AiMessage,
  AiStreamChunk,
  UsageAttribution,
  UsageRecord,
  AiTaskName,
} from '@storyboard/story-model';
import { projectUsageAttribution } from '@storyboard/story-model';
import { isAttributed } from '#ai/ai/aiResponseCoercion';
import { selectPromptVariant } from '#ai/ai/prompts/promptVariants';
import type { PromptVariantId } from '#ai/ai/prompts/types';
import type {
  GenerateTextOptions,
  OnUsageRecordCallback,
  StoryboardAiServiceOptions,
} from '#ai/ai/aiServiceTypes';
import type { TaskAiConfigResolved } from '#ai/ports/ConfigBridge';

export class AiTextGateway {
  public constructor(
    private readonly registry: AiProviderRegistry,
    private readonly options: StoryboardAiServiceOptions,
  ) {}

  public async generate(
    taskName: AiTaskName,
    messages: readonly AiMessage[],
    options: GenerateTextOptions,
  ): Promise<AiGenerateResponse> {
    const response: AiGenerateResponse = options.providerId
      ? await this.registry.generateWithProvider(options.providerId, {
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          reasoningEffort: options.reasoningEffort,
        })
      : await this.registry.generate({
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          reasoningEffort: options.reasoningEffort,
        });

    this.emitUsageIfNeeded(taskName, response, options.attribution);
    return response;
  }

  public async *generateStream(
    taskName: AiTaskName,
    messages: readonly AiMessage[],
    options: GenerateTextOptions,
  ): AsyncIterable<AiStreamChunk> {
    const stream: AsyncIterable<AiStreamChunk> = options.providerId
      ? this.registry.generateStreamWithProvider(options.providerId, {
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
        })
      : this.registry.generateStream({
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
        });

    for await (const chunk of stream) {
      if (chunk.type === 'done') {
        this.emitUsageIfNeeded(taskName, chunk.response, options.attribution);
      }
      yield chunk;
    }
  }

  public resolvePromptVariant(taskName: AiTaskName, options: GenerateTextOptions): PromptVariantId {
    const resolved: TaskAiConfigResolved = this.registry.getTaskAiConfig(taskName);
    const override: PromptVariantId | undefined = this.registry.getPromptVariantOverride();
    return selectPromptVariant({
      providerId: options.providerId ?? resolved.providerId,
      taskName,
      model: resolved.model,
      maxTokens: options.maxTokens,
      ...(override === undefined ? {} : { override }),
    });
  }

  private emitUsageIfNeeded(
    taskName: UsageRecord['taskName'],
    response: AiGenerateResponse,
    attribution: UsageAttribution | undefined,
  ): void {
    const onUsage: OnUsageRecordCallback | undefined = this.options.onUsage;

    if (!onUsage) {
      return;
    }

    onUsage({
      taskName,
      providerId: response.providerId,
      model: response.model,
      usage: response.usage,
      ...(response.costUsd === undefined ? {} : { costUsd: response.costUsd }),
      attribution:
        attribution !== undefined && isAttributed(attribution)
          ? attribution
          : projectUsageAttribution,
    });
  }
}
