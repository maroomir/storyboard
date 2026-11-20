import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import { GenerationTraceRecorder } from '#engine/persistence/generationTraceRecorder';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';

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

export function createTestAi(provided: Partial<AiServices> = {}): AiServices {
  return { traceRecorder: createSwitchedOffTraceRecorder(), ...provided } as AiServices;
}

export function createTestRepositories(
  provided: Partial<WorkspaceRepositories> = {},
): WorkspaceRepositories {
  return provided as WorkspaceRepositories;
}
