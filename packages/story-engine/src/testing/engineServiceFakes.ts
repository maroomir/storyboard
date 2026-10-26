import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';

export function createTestHost(provided: Partial<HostAdapters> = {}): HostAdapters {
  return provided as HostAdapters;
}

export function createTestAi(provided: Partial<AiServices> = {}): AiServices {
  return provided as AiServices;
}

export function createTestRepositories(
  provided: Partial<WorkspaceRepositories> = {},
): WorkspaceRepositories {
  return provided as WorkspaceRepositories;
}
