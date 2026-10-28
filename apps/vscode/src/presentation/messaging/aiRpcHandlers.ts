import type * as vscode from 'vscode';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { emptyUsageSummary, type StoryboardResponsePayload } from '@storyboard/story-model';
import { type StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import { AiProviderRegistry } from '@storyboard/story-ai';
import type { UsageRecorder } from '@/infrastructure/ai/UsageRecorder';

export interface AiRpcHandlersOptions {
  readonly onStreamChunk?: (requestId: string, delta: string) => Promise<void>;
}

export class AiRpc {
  public constructor(
    private readonly registry: AiProviderRegistry,
    private readonly options: AiRpcHandlersOptions = {},
  ) {}

  public handlers(): StoryboardRpcHandlers {
    return {
      'ai.providers.list': async (): Promise<StoryboardResponsePayload<'ai.providers.list'>> => ({
        providers: await this.registry.listProviders(),
      }),
      'ai.providers.checkConnection': async (
        payload,
      ): Promise<StoryboardResponsePayload<'ai.providers.checkConnection'>> =>
        this.registry.checkConnection(payload.providerId),
      'ai.generate': async (payload): Promise<StoryboardResponsePayload<'ai.generate'>> =>
        this.registry.generateWithProvider(payload.providerId, {
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

        for await (const chunk of this.registry.generateStreamWithProvider(payload.providerId, {
          taskName: payload.taskName,
          messages: payload.messages,
          temperature: payload.temperature,
          maxTokens: payload.maxTokens,
        })) {
          if (chunk.type === 'text-delta') {
            await this.options.onStreamChunk?.(request.id, chunk.delta);
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
}

export class UsageRpc {
  public constructor(private readonly recorder: UsageRecorder) {}

  public handlers(): Pick<StoryboardRpcHandlers, 'usage.read'> {
    return {
      'usage.read': async (): Promise<StoryboardResponsePayload<'usage.read'>> => {
        const root: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();

        if (!root) {
          return emptyUsageSummary();
        }

        return this.recorder.getSummary(root);
      },
    };
  }
}
