import type { AiProviderRegistry } from './providerRegistry';
import type {
  AiGenerateResponse,
  AiStreamChunk,
  UsageAttribution,
  UsageRecord,
  AiTaskName,
} from '#ai/contracts/aiTypes';
import { isAttributed } from './aiResponseCoercion';
import { selectPromptVariant } from './prompts/variant';
import type { PromptVariantId } from './prompts/types';
import type { GenerateTextOptions, StoryboardAiServiceOptions } from './aiServiceTypes';

export class AiTextGateway {
  public constructor(
    private readonly registry: AiProviderRegistry,
    private readonly options: StoryboardAiServiceOptions,
  ) {}

  public async generate(
    taskName: AiTaskName,
    messages: ReadonlyArray<{
      readonly role: 'system' | 'user' | 'assistant';
      readonly content: string;
    }>,
    options: GenerateTextOptions,
  ): Promise<AiGenerateResponse> {
    const response = options.providerId
      ? await this.registry.generateWithProvider(options.providerId, {
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
        })
      : await this.registry.generate({
          taskName,
          messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
        });

    this.emitUsageIfNeeded(taskName, response, options.attribution);
    return response;
  }

  public async *generateStream(
    taskName: AiTaskName,
    messages: ReadonlyArray<{
      readonly role: 'system' | 'user' | 'assistant';
      readonly content: string;
    }>,
    options: GenerateTextOptions,
  ): AsyncIterable<AiStreamChunk> {
    const stream = options.providerId
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
    const resolved = this.registry.getTaskAiConfig(taskName);
    const override = this.registry.getPromptVariantOverride();
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
    const onUsage = this.options.onUsage;

    if (!onUsage || !attribution || !isAttributed(attribution)) {
      return;
    }

    onUsage({
      taskName,
      providerId: response.providerId,
      model: response.model,
      usage: response.usage,
      ...(response.costUsd === undefined ? {} : { costUsd: response.costUsd }),
      attribution,
    });
  }
}
