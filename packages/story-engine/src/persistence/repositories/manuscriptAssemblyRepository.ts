import { joinStoryPath, type StoryUri } from '@storyboard/story-format';
import type { IFileSystem } from '#engine/ports/fileSystem';
import type {
  IManuscriptAssemblyRepository,
  ManuscriptAssemblySource,
} from '#engine/application/manuscript/assembleManuscriptUseCase';
import type {
  IManuscriptExportRepository,
  ManuscriptExportSource,
} from '#engine/application/manuscript/exportManuscriptUseCase';
import type {
  IManuscriptReviewRepository,
  ManuscriptReviewSource,
} from '#engine/application/manuscript/reviewManuscriptUseCase';
import type { IChapterSummaryRepository } from '#engine/application/manuscript/summarizeChaptersUseCase';
import { summaryFileName } from '#engine/domain/chapterSummaries';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { AssembledManuscript } from '@storyboard/story-format';
import { collectDraftsByOrder } from '#engine/persistence/manuscriptDrafts';
import { getStoryboardProjectPaths } from '#engine/paths/projectPaths';
import { readBibleFile, readChapterPlanFile } from '@storyboard/story-format';
import { readProjectJson } from '#engine/persistence/projectJson';

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
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const [project, volumeBytes] = await Promise.all([
      readProjectJson(this.fileSystem, paths.projectJson),
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
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const [project, plan, draftsByOrder] = await Promise.all([
      readProjectJson(this.fileSystem, paths.projectJson),
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
    const paths = getStoryboardProjectPaths(workspaceRoot);
    const [project, plan, draftsByOrder, canonFactLines] = await Promise.all([
      readProjectJson(this.fileSystem, paths.projectJson),
      readChapterPlanFile(paths.outlineChapters, this.fileSystem),
      collectDraftsByOrder(this.fileSystem, paths, this.fileSystem, logger),
      this.loadCanonFactLines(paths.bibleCanon),
    ]);

    return {
      source: { draftsByOrder, plan, projectName: project.name },
      styleConstraints: project.setting?.styleConstraints ?? [],
      qualityCriteria: project.setting?.qualityCriteria ?? [],
      canonFactLines,
    };
  }

  public async saveReview(workspaceRoot: StoryUri, markdown: string): Promise<StoryUri> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.manuscriptDirectory);
    const reportUri = joinStoryPath(paths.manuscriptDirectory, 'REVIEW.md');
    await this.fileSystem.writeFile(reportUri, new TextEncoder().encode(markdown));
    return reportUri;
  }

  public async saveChapterSummaries(workspaceRoot: StoryUri, markdown: string): Promise<StoryUri> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
    await this.fileSystem.createDirectory(paths.manuscriptDirectory);
    const summaryUri = joinStoryPath(paths.manuscriptDirectory, summaryFileName);
    await this.fileSystem.writeFile(summaryUri, new TextEncoder().encode(markdown));
    return summaryUri;
  }

  public async saveAssembly(
    workspaceRoot: StoryUri,
    manuscript: AssembledManuscript,
    foreshadowingMarkdown: string,
  ): Promise<StoryUri> {
    const paths = getStoryboardProjectPaths(workspaceRoot);
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

  private async loadCanonFactLines(bibleCanonUri: StoryUri): Promise<string[]> {
    if (!(await this.fileSystem.exists(bibleCanonUri))) {
      return [];
    }

    const bible = await readBibleFile(bibleCanonUri, this.fileSystem);
    return bible.facts
      .filter((fact) => fact.status === 'canon')
      .map((fact) => `${fact.subject.id} — ${fact.key}: ${fact.value}`);
  }
}
