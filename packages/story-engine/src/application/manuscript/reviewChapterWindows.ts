import type {
  AssembledManuscript,
  AiProviderId,
  ContinuityIssueLike,
  DraftCritiqueIssue,
  ChapterSummary,
  AssembledChapter,
} from '@storyboard/story-model';

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

export async function reviewChapterWindows(
  input: ChapterWindowReviewInput,
): Promise<ChapterWindowReviewResult> {
  const continuityIssues: ContinuityIssueLike[] = [];
  const critiqueIssues: DraftCritiqueIssue[] = [];
  const chapters: AssembledChapter[] = input.manuscript.chapters;

  for (const [index, chapter] of chapters.entries()) {
    input.onProgress?.(chapter.chapterTitle, index + 1, chapters.length);

    const facts: string[] = [
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

function buildStorySoFarLines(
  precedingChapters: readonly { readonly chapterTitle: string }[],
  storySoFar: readonly ChapterSummary[],
): string[] {
  const summaryByTitle: Map<string, string> = new Map(
    storySoFar.map((chapter) => [chapter.chapterTitle, chapter.summary]),
  );

  return precedingChapters.flatMap((chapter) => {
    const summary: string | undefined = summaryByTitle.get(chapter.chapterTitle);

    return summary === undefined
      ? []
      : [`지금까지의 줄거리 — ${chapter.chapterTitle}: ${summary.replace(/\s+/g, ' ').trim()}`];
  });
}
