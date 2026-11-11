import type { ChapterSummaryLedger } from '#engine/persistence/cache/chapterSummaryLedger';
import type { ChapterOutlineStore } from '#engine/persistence/bundles/chapterOutlineStore';
import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';
import {
  joinStoryPath,
  type StoryUri,
  getStoryboardProjectPaths,
  mainThreadId,
  type ChapterSummary,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type {
  AssembledManuscript,
  StoryboardProjectPaths,
} from '@storyboard/story-model';
import { DraftRepository } from '#engine/persistence/repositories/draftRepository';
import type { CardFactReader } from '#engine/persistence/bundles/cardFactReader';
import type {
  IChapterSummaryRepository,
  IManuscriptAssemblyRepository,
  IManuscriptExportRepository,
  IManuscriptReviewRepository,
  ManuscriptAssemblySource,
  ManuscriptExportSource,
  ManuscriptReviewSource,
} from '#engine/application/manuscript/manuscriptRepositories';

export const manuscriptReviewFileName: string = 'REVIEW.md';

export class ManuscriptAssemblyRepository
  implements
    IManuscriptAssemblyRepository,
    IChapterSummaryRepository,
    IManuscriptReviewRepository,
    IManuscriptExportRepository
{
  public constructor(
    private readonly fileSystem: IFileSystem,
    private readonly facts: CardFactReader,
    private readonly chapters: ChapterOutlineStore,
    private readonly summaries: ChapterSummaryLedger,
  ) {}

  public async hasChapterPlan(workspaceRoot: StoryUri): Promise<boolean> {
    return await this.fileSystem.exists(getStoryboardProjectPaths(workspaceRoot).outlineChapters);
  }

  public async hasManuscriptVolume(workspaceRoot: StoryUri): Promise<boolean> {
    return await this.fileSystem.exists(getStoryboardProjectPaths(workspaceRoot).manuscriptVolume);
  }

  public async loadVolume(workspaceRoot: StoryUri): Promise<ManuscriptExportSource> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const [project, volumeBytes] = await Promise.all([
      new ProjectRepository(this.fileSystem).read(paths.projectJson),
      this.fileSystem.readFile(paths.manuscriptVolume),
    ]);

    return { markdown: new TextDecoder().decode(volumeBytes), projectName: project.name };
  }

  public async saveExport(targetUri: StoryUri, content: string): Promise<void> {
    await this.fileSystem.writeFile(targetUri, new TextEncoder().encode(content));
  }

  public async loadAssemblySource(
    workspaceRoot: StoryUri,
    logger?: Pick<IStoryboardLogger, 'warn'>,
  ): Promise<ManuscriptAssemblySource> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const [project, plan, draftsByOrder] = await Promise.all([
      new ProjectRepository(this.fileSystem).read(paths.projectJson),
      this.chapters.load(workspaceRoot),
      new DraftRepository(this.fileSystem).collectByOrder(
        paths,
        logger ?? { warn: (): void => undefined },
      ),
    ]);

    return { draftsByOrder, plan, projectName: project.name };
  }

  public async loadReviewSource(
    workspaceRoot: StoryUri,
    logger: Pick<IStoryboardLogger, 'warn'>,
  ): Promise<ManuscriptReviewSource> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const [project, plan, draftsByOrder, canonFactLines, chapterSummaries] = await Promise.all([
      new ProjectRepository(this.fileSystem).read(paths.projectJson),
      this.chapters.load(workspaceRoot),
      new DraftRepository(this.fileSystem).collectByOrder(paths, logger),
      this.facts.readFactLines(workspaceRoot),
      this.loadFreshChapterSummaries(workspaceRoot),
    ]);

    return {
      source: { draftsByOrder, plan, projectName: project.name },
      styleConstraints: project.setting?.styleConstraints ?? [],
      qualityCriteria: project.setting?.qualityCriteria ?? [],
      canonFactLines,
      chapterSummaries,
    };
  }

  public async saveReview(workspaceRoot: StoryUri, markdown: string): Promise<StoryUri> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.manuscriptDirectory);
    const reportUri: StoryUri = joinStoryPath(paths.manuscriptDirectory, manuscriptReviewFileName);
    await this.fileSystem.writeFile(reportUri, new TextEncoder().encode(markdown));
    return reportUri;
  }

  public async readChapterSummaries(workspaceRoot: StoryUri): Promise<ChapterSummary[]> {
    return await this.summaries.read(workspaceRoot, mainThreadId);
  }

  public async saveChapterSummaries(
    workspaceRoot: StoryUri,
    summaries: readonly ChapterSummary[],
  ): Promise<void> {
    await this.summaries.write(workspaceRoot, mainThreadId, summaries);
  }

  public async saveAssembly(
    workspaceRoot: StoryUri,
    manuscript: AssembledManuscript,
    foreshadowingMarkdown: string,
  ): Promise<StoryUri> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.manuscriptDirectory);

    for (const chapter of manuscript.chapters) {
      await this.fileSystem.writeFile(
        joinStoryPath(paths.manuscriptDirectory, chapter.fileName),
        new TextEncoder().encode(chapter.markdown),
      );
    }
    await this.fileSystem.writeFile(
      paths.manuscriptVolume,
      new TextEncoder().encode(manuscript.volumeMarkdown),
    );
    await this.fileSystem.writeFile(
      joinStoryPath(paths.manuscriptDirectory, 'FORESHADOWING.md'),
      new TextEncoder().encode(foreshadowingMarkdown),
    );

    return paths.manuscriptVolume;
  }

  private async loadFreshChapterSummaries(workspaceRoot: StoryUri): Promise<ChapterSummary[]> {
    return await this.readChapterSummaries(workspaceRoot);
  }


}
