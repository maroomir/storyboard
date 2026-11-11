import { RevisionPlanRecorder, WorkspaceCaches, type IFileSystem } from "@storyboard/story-engine"
import { MemorySqlDatabaseHost } from "@storyboard/story-node"

const fileSystemThatOnlyMakesDirectories: IFileSystem = {
  createDirectory: async (): Promise<void> => undefined
} as unknown as IFileSystem

export function createMemoryCaches(): WorkspaceCaches {
  return new WorkspaceCaches({ host: new MemorySqlDatabaseHost(), fileSystem: fileSystemThatOnlyMakesDirectories })
}

export function createMemoryRevisionPlans(caches: WorkspaceCaches = createMemoryCaches()): RevisionPlanRecorder {
  return new RevisionPlanRecorder({ fileSystem: fileSystemThatOnlyMakesDirectories, caches })
}
