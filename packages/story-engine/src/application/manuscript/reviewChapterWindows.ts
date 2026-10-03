import type { AssembledManuscript } from '@storyboard/story-model';
import type {
  AiProviderId,
  ContinuityIssueLike,
  DraftCritiqueIssue,
} from '@storyboard/story-ai';
import type { ChapterSummary } from '#engine/domain/chapterSummaries';

export interface ChapterWindowReviewAiService {
  checkContinuity(
    body: string,
    facts: readonly string[],
    options: { readonly providerId: AiProviderId; readonly hasSceneMarkers?: boolean },
  ): Promise<ContinuityIssueLike[]>;
  critiqueDraft(
    input: {
      readonly body: string;
      readonly intent: string;
      readonly characters: readonly string[];
      readonly facts: readonly string[];
      readonly styleConstraints?: readonly string[];
      readonly qualityCriteria?: readonly string[];
      readonly hasSceneMarkers?: boolean;
    },
    options: { readonly providerId: AiProviderId },
  ): Promise<DraftCritiqueIssue[]>;
}

export interface ChapterWindowReviewInput {
  readonly aiService: ChapterWindowReviewAiService;
  readonly manuscript: AssembledManuscript;
  // 이미 검수한 앞 장들의 요약. 낡은 항목(§4.10)은 걸러 낸 것만 넘긴다.
  readonly storySoFar: readonly ChapterSummary[];
  readonly canonFactLines: readonly string[];
  readonly characters: readonly string[];
  readonly styleConstraints: readonly string[];
  readonly qualityCriteria: readonly string[];
  readonly hasSceneMarkers: boolean;
  readonly continuityProviderId: AiProviderId;
  readonly critiqueProviderId: AiProviderId;
  readonly onProgress?: (chapterTitle: string, current: number, total: number) => void;
}

export interface ChapterWindowReviewResult {
  readonly continuityIssues: readonly ContinuityIssueLike[];
  readonly critiqueIssues: readonly DraftCritiqueIssue[];
}

// 전권을 한 호출에 넣으면 뒤로 갈수록 모델의 주의가 옅어져, 30만 자 한복판의 모순은 실질적으로
// 검출되지 않는다. 장을 창으로 삼아 나누되, 앞 장은 요약으로 함께 실어 장 경계를 넘는 모순도
// 보이게 한다. 요약은 [설정] 줄로 들어가므로 프롬프트를 바꾸지 않고, 이슈의 offset도 그 장 본문
// 안에 머문다 — 보고서와 재작성 라우팅은 sceneStem으로 짚으므로 offset이 장 기준이어도 무방하다.
export async function reviewChapterWindows(
  input: ChapterWindowReviewInput,
): Promise<ChapterWindowReviewResult> {
  const continuityIssues: ContinuityIssueLike[] = [];
  const critiqueIssues: DraftCritiqueIssue[] = [];
  const chapters = input.manuscript.chapters;

  for (const [index, chapter] of chapters.entries()) {
    input.onProgress?.(chapter.chapterTitle, index + 1, chapters.length);

    const facts = [
      ...input.canonFactLines,
      ...buildStorySoFarLines(chapters.slice(0, index), input.storySoFar),
    ];

    const [continuity, critique] = await Promise.all([
      input.aiService.checkContinuity(chapter.markdown, facts, {
        providerId: input.continuityProviderId,
        hasSceneMarkers: input.hasSceneMarkers,
      }),
      input.aiService.critiqueDraft(
        {
          body: chapter.markdown,
          intent: `${chapter.chapterTitle} 검수`,
          characters: input.characters,
          facts,
          styleConstraints: input.styleConstraints,
          qualityCriteria: input.qualityCriteria,
          hasSceneMarkers: input.hasSceneMarkers,
        },
        { providerId: input.critiqueProviderId },
      ),
    ]);

    continuityIssues.push(...continuity);
    critiqueIssues.push(...critique);
  }

  return { continuityIssues, critiqueIssues };
}

// 앞 장의 줄거리는 이번 장이 지켜야 할 사실이므로 [설정] 줄로 넘긴다. 요약은 여러 문장이라
// 한 줄로 눌러 담아야 나머지 사실 줄과 같은 모양이 된다.
function buildStorySoFarLines(
  precedingChapters: readonly { readonly chapterTitle: string }[],
  storySoFar: readonly ChapterSummary[],
): string[] {
  const summaryByTitle = new Map(
    storySoFar.map((chapter) => [chapter.chapterTitle, chapter.summary]),
  );

  return precedingChapters.flatMap((chapter) => {
    const summary = summaryByTitle.get(chapter.chapterTitle);

    return summary === undefined
      ? []
      : [`지금까지의 줄거리 — ${chapter.chapterTitle}: ${summary.replace(/\s+/g, ' ').trim()}`];
  });
}
