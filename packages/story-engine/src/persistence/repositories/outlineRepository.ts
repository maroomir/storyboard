import type { StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IOutlineRepository } from '#engine/application/novel/generateOutlineUseCase';
import { listCharacterBriefs } from '#engine/persistence/characterBriefs';
import { getStoryboardProjectPaths } from '#engine/paths/projectPaths';
import {
  readChapterPlanFile,
  writeChapterPlanFile,
  writeSynopsisFile,
} from '@storyboard/story-format';
import type {
  ChapterPlan,
  OutlineCharacterBrief,
  OutlineSynopsis,
  StoryboardProject,
} from '@storyboard/story-format';
import { readProjectJson } from '#engine/persistence/projectJson';
export class OutlineRepository implements IOutlineRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async hasExisting(workspaceRoot: StoryUri): Promise<boolean> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    return (
      (await this.fileSystem.exists(paths.outlineSynopsis)) ||
      (await this.fileSystem.exists(paths.outlineChapters))
    );
  }

  public async loadCharacterBriefs(
    workspaceRoot: StoryUri,
  ): Promise<readonly OutlineCharacterBrief[]> {
    return await listCharacterBriefs(
      this.fileSystem,
      getStoryboardProjectPaths(workspaceRoot).characterDirectory,
    );
  }

  public async loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject> {
    return await readProjectJson(
      this.fileSystem,
      getStoryboardProjectPaths(workspaceRoot).projectJson,
    );
  }

  public async loadChapterPlan(workspaceRoot: StoryUri): Promise<ChapterPlan> {
    return await readChapterPlanFile(
      getStoryboardProjectPaths(workspaceRoot).outlineChapters,
      this.fileSystem,
    );
  }

  public async save(
    workspaceRoot: StoryUri,
    synopsis: OutlineSynopsis,
    chapterPlan: ChapterPlan,
  ): Promise<StoryUri> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.outlineDirectory);
    await writeSynopsisFile(paths.outlineSynopsis, this.fileSystem, synopsis);
    await writeChapterPlanFile(paths.outlineChapters, this.fileSystem, chapterPlan);
    return paths.outlineSynopsis;
  }
}
