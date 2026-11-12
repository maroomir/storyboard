import { outlineOfChapterPlan, parseChapterPlan, serializeChapterOutline, type StoryUri } from "@storyboard/story-model"
import { ChapterOutlineStore, type IFileSystem, type WorkspaceCaches, type WorkspaceScenes } from "@storyboard/story-engine"

import { createMemoryCaches } from "./caches"

export function unseededOutlineYaml(chapterPlanYaml: string): string {
  return serializeChapterOutline(outlineOfChapterPlan(parseChapterPlan(chapterPlanYaml), () => undefined))
}

const fileSystemThatDiscardsWrites: IFileSystem = {
  createDirectory: async (): Promise<void> => undefined,
  writeFile: async (): Promise<void> => undefined
} as unknown as IFileSystem

export async function cachesWithPendingChapterPlan(
  workspaceRoot: StoryUri,
  chapterPlanYaml: string
): Promise<WorkspaceCaches> {
  const caches: WorkspaceCaches = createMemoryCaches()
  await new ChapterOutlineStore({
    fileSystem: fileSystemThatDiscardsWrites,
    scenes: {} as WorkspaceScenes,
    caches
  }).save(workspaceRoot, parseChapterPlan(chapterPlanYaml))
  return caches
}
