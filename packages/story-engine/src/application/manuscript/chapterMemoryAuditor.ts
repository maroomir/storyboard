import {
  assembleManuscript,
  auditChapterSummaries,
  buildChapterSummariesMarkdown,
  computeDraftBodyHash,
  formatChapterSummaryStaleWarning,
  parseChapterSummariesMarkdown,
  readChapterPlanFile,
} from '@storyboard/story-model';
import type {
  AssembledManuscript,
  ChapterSummary,
  ChapterSummaryAudit,
  StoryboardProject,
  StoryboardProjectPaths,
} from '@storyboard/story-model';
import { DraftRepository } from '#engine/persistence/repositories/draftRepository';
import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';
import type { IFileSystem } from '#engine/ports/fileSystem';

export interface ChapterSummaryAuditRequest {
  readonly fileSystem: IFileSystem;
  readonly paths: StoryboardProjectPaths;
}

export interface ChapterMemoryAudit {
  readonly audit: ChapterSummaryAudit;
  readonly staleWarning: string | undefined;
  readonly projectName: string;
  readonly needsMarking: boolean;
}

const emptyAudit: ChapterSummaryAudit = {
  summaries: [],
  staleChapterTitles: [],
  unsealedChapterTitles: [],
};

const idleAudit: ChapterMemoryAudit = {
  audit: emptyAudit,
  staleWarning: undefined,
  projectName: '',
  needsMarking: false,
};

export class ChapterMemoryAuditor {
  public constructor(private readonly request: ChapterSummaryAuditRequest) {}

  public async audit(): Promise<ChapterMemoryAudit> {
    const { fileSystem, paths } = this.request;

    if (
      !(await fileSystem.exists(paths.chapterSummaries)) ||
      !(await fileSystem.exists(paths.outlineChapters))
    ) {
      return idleAudit;
    }

    try {
      const markdown: string = new TextDecoder().decode(
        await fileSystem.readFile(paths.chapterSummaries),
      );
      const summaries: ChapterSummary[] = parseChapterSummariesMarkdown(markdown);

      if (summaries.length === 0) {
        return idleAudit;
      }

      const project: StoryboardProject = await new ProjectRepository(fileSystem).read(
        paths.projectJson,
      );
      const audit: ChapterSummaryAudit = auditChapterSummaries(
        summaries,
        await this.collectCurrentChapterHashes(project.name),
      );

      return {
        audit,
        staleWarning: formatChapterSummaryStaleWarning(audit),
        projectName: project.name,
        needsMarking:
          buildChapterSummariesMarkdown(project.name, audit.summaries) !==
          buildChapterSummariesMarkdown(project.name, summaries),
      };
    } catch {
      return idleAudit;
    }
  }

  public async markStale(audit: ChapterMemoryAudit): Promise<void> {
    if (!audit.needsMarking) {
      return;
    }

    await this.request.fileSystem.writeFile(
      this.request.paths.chapterSummaries,
      new TextEncoder().encode(
        buildChapterSummariesMarkdown(audit.projectName, audit.audit.summaries),
      ),
    );
  }

  public async collectCurrentChapterHashes(projectName: string): Promise<Map<string, string>> {
    const { fileSystem, paths } = this.request;
    const [plan, draftsByOrder] = await Promise.all([
      readChapterPlanFile(paths.outlineChapters, fileSystem),
      new DraftRepository(fileSystem).collectByOrder(paths, { warn: (): void => undefined }),
    ]);
    const manuscript: AssembledManuscript = assembleManuscript({
      draftsByOrder,
      plan,
      projectName,
    });

    return new Map(
      manuscript.chapters.map((chapter) => [
        chapter.chapterTitle,
        computeDraftBodyHash(chapter.markdown),
      ]),
    );
  }
}
