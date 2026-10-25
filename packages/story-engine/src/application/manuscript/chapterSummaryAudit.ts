import {
  assembleManuscript,
  computeDraftBodyHash,
  readChapterPlanFile,
  auditChapterSummaries,
  buildChapterSummariesMarkdown,
  formatChapterSummaryStaleWarning,
  parseChapterSummariesMarkdown,
  type ChapterSummaryAudit,
} from '@storyboard/story-model';
import { collectDraftsByOrder } from '#engine/persistence/manuscriptDrafts';
import { readProjectJson } from '#engine/persistence/projectJson';
import type {
  AssembledManuscript,
  ChapterSummary,
  StoryboardProject,
  StoryboardProjectPaths,
} from '@storyboard/story-model';
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

export async function auditChapterMemory(
  request: ChapterSummaryAuditRequest,
): Promise<ChapterMemoryAudit> {
  const { fileSystem, paths } = request;
  const idle: ChapterMemoryAudit = {
    audit: emptyAudit,
    staleWarning: undefined,
    projectName: '',
    needsMarking: false,
  };

  if (
    !(await fileSystem.exists(paths.chapterSummaries)) ||
    !(await fileSystem.exists(paths.outlineChapters))
  ) {
    return idle;
  }

  try {
    const markdown: string = new TextDecoder().decode(
      await fileSystem.readFile(paths.chapterSummaries),
    );
    const summaries: ChapterSummary[] = parseChapterSummariesMarkdown(markdown);

    if (summaries.length === 0) {
      return idle;
    }

    const project: StoryboardProject = await readProjectJson(fileSystem, paths.projectJson);
    const audit: ChapterSummaryAudit = auditChapterSummaries(
      summaries,
      await collectCurrentChapterHashes(request, project.name),
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
    return idle;
  }
}

export async function markStaleChapterSummaries(
  request: ChapterSummaryAuditRequest,
  audit: ChapterMemoryAudit,
): Promise<void> {
  if (!audit.needsMarking) {
    return;
  }

  await request.fileSystem.writeFile(
    request.paths.chapterSummaries,
    new TextEncoder().encode(
      buildChapterSummariesMarkdown(audit.projectName, audit.audit.summaries),
    ),
  );
}

export async function collectCurrentChapterHashes(
  request: ChapterSummaryAuditRequest,
  projectName: string,
): Promise<Map<string, string>> {
  const { fileSystem, paths } = request;
  const [plan, draftsByOrder] = await Promise.all([
    readChapterPlanFile(paths.outlineChapters, fileSystem),
    collectDraftsByOrder(fileSystem, paths, fileSystem, { warn: (): void => undefined }),
  ]);
  const manuscript: AssembledManuscript = assembleManuscript({ draftsByOrder, plan, projectName });

  return new Map(
    manuscript.chapters.map((chapter) => [
      chapter.chapterTitle,
      computeDraftBodyHash(chapter.markdown),
    ]),
  );
}
