import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';
import {
  joinStoryPath,
  type StoryUri,
  readBibleFile,
  readChapterPlanFile,
  getStoryboardProjectPaths,
  parseChapterSummariesMarkdown,
  type ChapterSummary,
} from '@storyboard/story-model';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type {
  AssembledManuscript,
  StoryBible,
  StoryboardProjectPaths,
} from '@storyboard/story-model';
import { collectDraftsByOrder } from '#engine/persistence/manuscriptDrafts';
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
  public constructor(private readonly fileSystem: IFileSystem) {}

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
      readChapterPlanFile(paths.outlineChapters, this.fileSystem),
      collectDraftsByOrder(
        this.fileSystem,
        paths,
        this.fileSystem,
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
      readChapterPlanFile(paths.outlineChapters, this.fileSystem),
      collectDraftsByOrder(this.fileSystem, paths, this.fileSystem, logger),
      this.loadCanonFactLines(paths.bibleCanon),
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

  public async readChapterSummaries(workspaceRoot: StoryUri): Promise<string | undefined> {
    const summaryUri: StoryUri = getStoryboardProjectPaths(workspaceRoot).chapterSummaries;

    if (!(await this.fileSystem.exists(summaryUri))) {
      return undefined;
    }

    return new TextDecoder().decode(await this.fileSystem.readFile(summaryUri));
  }

  public async saveChapterSummaries(workspaceRoot: StoryUri, markdown: string): Promise<StoryUri> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.memoryDirectory);
    const summaryUri: StoryUri = paths.chapterSummaries;
    await this.fileSystem.writeFile(summaryUri, new TextEncoder().encode(markdown));
    return summaryUri;
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
    const markdown: string | undefined = await this.readChapterSummaries(workspaceRoot);

    return markdown === undefined
      ? []
      : parseChapterSummariesMarkdown(markdown).filter((chapter) => chapter.isStale !== true);
  }

  private async loadCanonFactLines(bibleCanonUri: StoryUri): Promise<string[]> {
    if (!(await this.fileSystem.exists(bibleCanonUri))) {
      return [];
    }

    const bible: StoryBible = await readBibleFile(bibleCanonUri, this.fileSystem);
    return bible.facts
      .filter((fact) => fact.status === 'canon')
      .map((fact) => `${fact.subject.id} — ${fact.key}: ${fact.value}`);
  }
}
