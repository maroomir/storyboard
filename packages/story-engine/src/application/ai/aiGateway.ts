import type { StoryUri, AiProviderId, AiTaskName, UsageRecord } from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { StoryboardAiService } from '@storyboard/story-ai';
import type { AiProviderRegistry, TaskAiConfigResolved } from '@storyboard/story-ai';
import type { IUsageSink } from '#engine/ports/usageSink';
import type { GenerationTraceRecorder } from '#engine/persistence/generationTraceRecorder';
export class AiGateway {
  public constructor(
    private readonly providerRegistry: AiProviderRegistry,
    private readonly usageSink: IUsageSink,
    private readonly logger: IStoryboardLogger,
    private readonly traceRecorder: GenerationTraceRecorder,
  ) {}

  public createService(workspaceUri: StoryUri): StoryboardAiService {
    return new StoryboardAiService(this.providerRegistry, {
      onUsage: (record): void => {
        const stage: string | undefined = this.traceRecorder.currentStageOf(workspaceUri);
        const stagedRecord: UsageRecord = stage === undefined ? record : { ...record, stage };
        void this.usageSink.record(workspaceUri, stagedRecord).catch((error: unknown) => {
          this.logger.error('사용량 기록에 실패했습니다.', error);
        });
      },
      onCall: (observation): void => {
        void this.traceRecorder.recordCall(workspaceUri, observation);
      },
    });
  }

  public getTaskProvider(taskName: AiTaskName): AiProviderId {
    return this.providerRegistry.getTaskProvider(taskName);
  }

  public getTaskAiConfig(taskName: AiTaskName): TaskAiConfigResolved {
    return this.providerRegistry.getTaskAiConfig(taskName);
  }
}
