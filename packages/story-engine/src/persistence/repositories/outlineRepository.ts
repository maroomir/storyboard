import type {
  StoryUri,
  ChapterPlan,
  OutlineCharacterBrief,
  OutlineSynopsis,
  StoryboardProject,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IOutlineRepository } from '#engine/application/novel/generateOutlineUseCase';
import { listCharacterBriefs } from '#engine/persistence/characterBriefs';
import {
  getStoryboardProjectPaths,
  parseSynopsisMarkdown,
  readChapterPlanFile,
  writeChapterPlanFile,
  writeSynopsisFile,
} from '@storyboard/story-model';
import { readProjectJson } from '#engine/persistence/projectJson';
import { loadNarratorCards } from '#engine/persistence/narratorCards';
export class OutlineRepository implements IOutlineRepository {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async hasExisting(workspaceRoot: StoryUri): Promise<boolean> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    return (
      (await this.fileSystem.exists(paths.outlineSynopsis)) ||
      (await this.fileSystem.exists(paths.outlineChapters))
    );
  }

  public async hasChapterPlan(workspaceRoot: StoryUri): Promise<boolean> {
    return await this.fileSystem.exists(getStoryboardProjectPaths(workspaceRoot).outlineChapters);
  }

  public async loadCharacterBriefs(
    workspaceRoot: StoryUri,
  ): Promise<readonly OutlineCharacterBrief[]> {
    return await listCharacterBriefs(
      this.fileSystem,
      getStoryboardProjectPaths(workspaceRoot).characterDirectory,
    );
  }

  public async loadNarratorIds(workspaceRoot: StoryUri): Promise<readonly string[]> {
    const narrators = await loadNarratorCards(
      getStoryboardProjectPaths(workspaceRoot),
      this.fileSystem,
    );

    return [...narrators.keys()];
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

  public async loadSynopsis(workspaceRoot: StoryUri): Promise<OutlineSynopsis | undefined> {
    const synopsisUri = getStoryboardProjectPaths(workspaceRoot).outlineSynopsis;

    if (!(await this.fileSystem.exists(synopsisUri))) {
      return undefined;
    }

    return parseSynopsisMarkdown(
      new TextDecoder().decode(await this.fileSystem.readFile(synopsisUri)),
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
