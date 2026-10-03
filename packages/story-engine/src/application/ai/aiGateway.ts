import type { StoryUri, AiProviderId, AiTaskName } from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { StoryboardAiService } from '@storyboard/story-ai';
import type { AiProviderRegistry } from '@storyboard/story-ai';
import type { IUsageSink } from '#engine/ports/usageSink';
export class AiGateway {
  public constructor(
    private readonly providerRegistry: AiProviderRegistry,
    private readonly usageSink: IUsageSink,
    private readonly logger: IStoryboardLogger,
  ) {}

  public createService(workspaceUri: StoryUri): StoryboardAiService {
    return new StoryboardAiService(this.providerRegistry, {
      // NOTE: usage accounting must never fail a generation the user already paid for.
      onUsage: (record): void => {
        void this.usageSink.record(workspaceUri, record).catch((error: unknown) => {
          this.logger.error('사용량 기록에 실패했습니다.', error);
        });
      },
    });
  }

  public getTaskProvider(taskName: AiTaskName): AiProviderId {
    return this.providerRegistry.getTaskProvider(taskName);
  }

  public getTaskAiConfig(taskName: AiTaskName): {
    readonly providerId: AiProviderId;
    readonly model: string;
  } {
    return this.providerRegistry.getTaskAiConfig(taskName);
  }
}
