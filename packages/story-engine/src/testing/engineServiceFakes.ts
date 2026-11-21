import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type { AiProviderRegistry } from '@storyboard/story-ai';
import { AiGateway } from '#engine/application/ai/aiGateway';
import { GenerationTraceRecorder } from '#engine/persistence/generationTraceRecorder';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { IUsageSink } from '#engine/ports/usageSink';

function createSwitchedOffTraceRecorder(): GenerationTraceRecorder {
  return new GenerationTraceRecorder({
    fileSystem: {} as IFileSystem,
    logger: {} as IStoryboardLogger,
    isEnabled: () => false,
    keepRunCount: () => 0,
    isFinalBeatCheckEnabled: () => false,
  });
}

export function createTestHost(provided: Partial<HostAdapters> = {}): HostAdapters {
  return provided as HostAdapters;
}

const discardedUsageSink: IUsageSink = { record: async (): Promise<void> => undefined };

export function createTestAi(provided: Partial<AiServices> = {}): AiServices {
  const traceRecorder: GenerationTraceRecorder = provided.traceRecorder ?? createSwitchedOffTraceRecorder();
  const gateway: AiGateway =
    provided.gateway ??
    new AiGateway(
      provided.providerRegistry ?? ({} as AiProviderRegistry),
      provided.usageSink ?? discardedUsageSink,
      {} as IStoryboardLogger,
      traceRecorder,
    );
  return { ...provided, traceRecorder, gateway } as AiServices;
}

export function createTestRepositories(
  provided: Partial<WorkspaceRepositories> = {},
): WorkspaceRepositories {
  return provided as WorkspaceRepositories;
}
