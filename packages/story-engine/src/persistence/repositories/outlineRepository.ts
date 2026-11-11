import type { ChapterOutlineStore } from '#engine/persistence/bundles/chapterOutlineStore';
import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';
import type {
  StoryUri,
  ChapterPlan,
  GeneratedSceneSeed,
  OutlineCharacterBrief,
  OutlineSynopsis,
  StoryboardProject,
  StoryboardProjectPaths,
  NarratorCard,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import {
  getStoryboardProjectPaths,
  parseSynopsisMarkdown,
  writeSynopsisFile,
} from '@storyboard/story-model';
import { NarratorCardRepository } from '#engine/persistence/repositories/narratorCardRepository';
import type { IOutlineRepository } from '#engine/application/novel/novelPipelinePorts';
export class OutlineRepository implements IOutlineRepository {
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly cards: WorkspaceCards,
    private readonly chapters: ChapterOutlineStore,
  ) {}

  public async hasExisting(workspaceRoot: StoryUri): Promise<boolean> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
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
    return (await this.cards.loadRoster(workspaceRoot, ['character'])).characters.map((card) => ({
      id: card.id,
      name: card.name,
      role: card.role,
    }));
  }

  public async loadNarratorIds(workspaceRoot: StoryUri): Promise<readonly string[]> {
    const narrators: ReadonlyMap<string, NarratorCard> = await new NarratorCardRepository(
      this.cards,
    ).list(workspaceRoot);

    return [...narrators.keys()];
  }

  public async loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject> {
    return await new ProjectRepository(this.fileSystem).read(
      getStoryboardProjectPaths(workspaceRoot).projectJson,
    );
  }

  public async loadChapterPlan(workspaceRoot: StoryUri): Promise<ChapterPlan> {
    return await this.chapters.load(workspaceRoot);
  }

  public async recordSeeded(
    workspaceRoot: StoryUri,
    plan: ChapterPlan,
    seeds: readonly GeneratedSceneSeed[],
  ): Promise<void> {
    await this.chapters.recordSeeded(workspaceRoot, plan, seeds);
  }

  public async loadSynopsis(workspaceRoot: StoryUri): Promise<OutlineSynopsis | undefined> {
    const synopsisUri: StoryUri = getStoryboardProjectPaths(workspaceRoot).outlineSynopsis;

    if (!(await this.fileSystem.exists(synopsisUri))) {
      return undefined;
    }

    return parseSynopsisMarkdown(
      new TextDecoder().decode(await this.fileSystem.readFile(synopsisUri)),
    );
  }

  public async saveSynopsis(workspaceRoot: StoryUri, synopsis: OutlineSynopsis): Promise<void> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.outlineDirectory);
    await writeSynopsisFile(paths.outlineSynopsis, this.fileSystem, synopsis);
  }

  public async save(
    workspaceRoot: StoryUri,
    synopsis: OutlineSynopsis,
    chapterPlan: ChapterPlan,
  ): Promise<StoryUri> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    await this.saveSynopsis(workspaceRoot, synopsis);
    await this.chapters.save(workspaceRoot, chapterPlan);
    return paths.outlineSynopsis;
  }
}
