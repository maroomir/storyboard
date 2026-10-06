import type { AiProviderRegistry } from './providerRegistry';
import type {
  AiGenerateResponse,
  AiStreamChunk,
  UsageAttribution,
  UsageRecord,
  AiTaskName,
} from '@storyboard/story-model';
import { projectUsageAttribution } from '@storyboard/story-model';
import { isAttributed } from './aiResponseCoercion';
import { selectPromptVariant } from './prompts/promptVariants';
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

    if (!onUsage) {
      return;
    }

    // NOTE: 귀속이 없는 호출을 버리면 원장·예산·/cost 어디에도 잡히지 않는다. 씬이나 카드에 속하지
    // 않는 호출은 작품에 귀속한다.
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
