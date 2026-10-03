import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { emptyUsageSummary, type StoryboardResponsePayload } from '@storyboard/story-model';
import { type StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import { AiProviderRegistry } from '@storyboard/story-ai';
import type { UsageRecorder } from '@/infrastructure/ai/UsageRecorder';

export interface AiRpcHandlersOptions {
  readonly onStreamChunk?: (requestId: string, delta: string) => Promise<void>;
}

export function createAiRpcHandlers(
  registry: AiProviderRegistry,
  options: AiRpcHandlersOptions = {},
): StoryboardRpcHandlers {
  return {
    'ai.providers.list': async (): Promise<StoryboardResponsePayload<'ai.providers.list'>> => ({
      providers: await registry.listProviders(),
    }),
    'ai.providers.checkConnection': async (
      payload,
    ): Promise<StoryboardResponsePayload<'ai.providers.checkConnection'>> =>
      registry.checkConnection(payload.providerId),
    'ai.generate': async (payload): Promise<StoryboardResponsePayload<'ai.generate'>> =>
      registry.generateWithProvider(payload.providerId, {
        taskName: payload.taskName,
        messages: payload.messages,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens,
      }),
    'ai.generateStream': async (
      payload,
      request,
    ): Promise<StoryboardResponsePayload<'ai.generateStream'>> => {
      let finalResponse: StoryboardResponsePayload<'ai.generateStream'> | undefined;

      for await (const chunk of registry.generateStreamWithProvider(payload.providerId, {
        taskName: payload.taskName,
        messages: payload.messages,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens,
      })) {
        if (chunk.type === 'text-delta') {
          await options.onStreamChunk?.(request.id, chunk.delta);
          continue;
        }

        finalResponse = chunk.response;
      }

      if (!finalResponse) {
        throw new Error('AI streaming completed without a final response.');
      }

      return finalResponse;
    },
  };
}

export function createUsageRpcHandlers(
  recorder: UsageRecorder,
): Pick<StoryboardRpcHandlers, 'usage.read'> {
  return {
    'usage.read': async (): Promise<StoryboardResponsePayload<'usage.read'>> => {
      const root = await resolveStoryboardWorkspaceRoot();

      if (!root) {
        return emptyUsageSummary();
      }

      return recorder.getSummary(root);
    },
  };
}
