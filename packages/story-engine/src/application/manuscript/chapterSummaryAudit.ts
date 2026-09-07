import {
  assembleManuscript,
  computeDraftBodyHash,
  readChapterPlanFile,
} from '@storyboard/story-format';
import {
  auditChapterSummaries,
  buildChapterSummariesMarkdown,
  formatChapterSummaryStaleWarning,
  parseChapterSummariesMarkdown,
  type ChapterSummaryAudit,
} from '#engine/domain/chapterSummaries';
import { collectDraftsByOrder } from '#engine/persistence/manuscriptDrafts';
import { readProjectJson } from '#engine/persistence/projectJson';
import type { StoryboardProjectPaths } from '#engine/paths/projectPaths';
import type { IFileSystem } from '#engine/ports/fileSystem';

export interface ChapterSummaryAuditRequest {
  readonly fileSystem: IFileSystem;
  readonly paths: StoryboardProjectPaths;
}

export interface ChapterMemoryAudit {
  readonly audit: ChapterSummaryAudit;
  readonly staleWarning: string | undefined;
  readonly projectName: string;
  // 감사가 새로 찾아낸 낡음이 있어 요약 파일의 표시가 실제와 다른 상태.
  readonly needsMarking: boolean;
}

const emptyAudit: ChapterSummaryAudit = {
  summaries: [],
  staleChapterTitles: [],
  unsealedChapterTitles: [],
};

// 요약 파일이나 장 계획이 없으면 장이라는 단위 자체가 없다. 초안을 읽기 전에 빠져나가, 요약을 쓰지
// 않는 워크스페이스가 씬을 생성할 때마다 draft 디렉터리를 훑는 일을 만들지 않는다.
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
    const markdown = new TextDecoder().decode(await fileSystem.readFile(paths.chapterSummaries));
    const summaries = parseChapterSummariesMarkdown(markdown);

    if (summaries.length === 0) {
      return idle;
    }

    const project = await readProjectJson(fileSystem, paths.projectJson);
    const audit = auditChapterSummaries(
      summaries,
      await collectCurrentChapterHashes(request, project.name),
    );

    return {
      audit,
      staleWarning: formatChapterSummaryStaleWarning(audit),
      projectName: project.name,
      // 표시가 실제로 바뀐 경우에만 쓴다. 같은 빌더로 양쪽을 렌더링해, 파일 서식 차이가 아니라
      // 낡음 표시의 차이만 비교한다 — 봇에서는 요약 저장이 곧 커밋이다.
      needsMarking:
        buildChapterSummariesMarkdown(project.name, audit.summaries) !==
        buildChapterSummariesMarkdown(project.name, summaries),
    };
  } catch {
    // 요약을 읽지 못하는 것은 생성을 막을 일이 아니다. 이번 씬은 감사 없이 진행한다.
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

// 요약의 입력은 그 장으로 조립된 본문 자체다. 조립 결과를 그대로 해싱하면 초안 수정·씬 추가·계획
// 순서 변경이 모두 같은 한 값으로 잡힌다.
export async function collectCurrentChapterHashes(
  request: ChapterSummaryAuditRequest,
  projectName: string,
): Promise<Map<string, string>> {
  const { fileSystem, paths } = request;
  const [plan, draftsByOrder] = await Promise.all([
    readChapterPlanFile(paths.outlineChapters, fileSystem),
    collectDraftsByOrder(fileSystem, paths, fileSystem, { warn: (): void => undefined }),
  ]);
  const manuscript = assembleManuscript({ draftsByOrder, plan, projectName });

  return new Map(
    manuscript.chapters.map((chapter) => [
      chapter.chapterTitle,
      computeDraftBodyHash(chapter.markdown),
    ]),
  );
}
