import { describe, expect, it } from 'vitest';

import {
  SummarizeChaptersUseCase,
  buildChapterSummariesMarkdown,
  mergeChapterSummary,
  parseChapterSummariesMarkdown,
} from '@storyboard/story-engine';

describe('chapter summaries markdown', () => {
  it('round-trips what it renders', () => {
    const summaries = [
      { chapterTitle: '1장 출발', summary: '이준이 마을을 떠난다.' },
      { chapterTitle: '2장 대장간', summary: '브로크가 검을 건넨다.' },
    ];

    const parsed = parseChapterSummariesMarkdown(buildChapterSummariesMarkdown('작품', summaries));

    expect(parsed).toEqual(summaries);
  });

  it('drops the rendered recap line so it is not stored twice', () => {
    const markdown = buildChapterSummariesMarkdown('작품', [
      { chapterTitle: '1장', summary: '앞 장 내용' },
      { chapterTitle: '2장', summary: '뒷 장 내용' },
    ]);

    expect(markdown).toContain('이전 장 recap');
    expect(parseChapterSummariesMarkdown(markdown)[1]?.summary).toBe('뒷 장 내용');
  });

  it('replaces a chapter in place and appends an unseen one', () => {
    const summaries = [{ chapterTitle: '1장', summary: '옛 요약' }];

    expect(mergeChapterSummary(summaries, { chapterTitle: '1장', summary: '새 요약' })).toEqual([
      { chapterTitle: '1장', summary: '새 요약' },
    ]);
    expect(mergeChapterSummary(summaries, { chapterTitle: '2장', summary: '둘째' })).toEqual([
      { chapterTitle: '1장', summary: '옛 요약' },
      { chapterTitle: '2장', summary: '둘째' },
    ]);
  });
});

describe('SummarizeChaptersUseCase', () => {
  const workspaceUri = { fsPath: '/workspace' } as never;

  function createUseCase(existingMarkdown?: string): {
    readonly useCase: SummarizeChaptersUseCase;
    readonly saved: string[];
    readonly summarized: string[];
  } {
    const saved: string[] = [];
    const summarized: string[] = [];

    const aiGateway = {
      createService: () => ({
        summarizeChapter: async ({ chapterTitle }: { chapterTitle: string }): Promise<string> => {
          summarized.push(chapterTitle);
          return `${chapterTitle} 요약`;
        },
      }),
      getTaskProvider: () => 'mock',
    } as never;

    const repository = {
      hasChapterPlan: async (): Promise<boolean> => true,
      loadAssemblySource: async (): Promise<unknown> => ({
        draftsByOrder: new Map([
          [1, { stem: '01-scene-1', body: '1장 본문' }],
          [2, { stem: '02-scene-2', body: '2장 본문' }],
        ]),
        plan: {
          version: 1,
          acts: [
            {
              title: '1막',
              chapters: [
                { title: '1장', scenes: [{ id: 's1', title: '씬1' }] },
                { title: '2장', scenes: [{ id: 's2', title: '씬2' }] },
              ],
            },
          ],
        },
        projectName: '작품',
      }),
      readChapterSummaries: async (): Promise<string | undefined> => existingMarkdown,
      saveChapterSummaries: async (_root: unknown, markdown: string): Promise<unknown> => {
        saved.push(markdown);
        return workspaceUri;
      },
    } as never;

    return { useCase: new SummarizeChaptersUseCase(aiGateway, repository), saved, summarized };
  }

  it('summarizes every chapter when no index is given', async () => {
    const { useCase, summarized } = createUseCase();

    const result = await useCase.execute(workspaceUri);

    expect(result).toMatchObject({ ok: true, summaryCount: 2 });
    expect(summarized).toEqual(['1장', '2장']);
  });

  it('summarizes only the named chapter and merges it into the existing file', async () => {
    const existing = buildChapterSummariesMarkdown('작품', [
      { chapterTitle: '1장', summary: '먼저 쓴 요약' },
    ]);
    const { useCase, saved, summarized } = createUseCase(existing);

    const result = await useCase.execute(workspaceUri, { chapterIndex: 1 });

    expect(result).toMatchObject({ ok: true, summaryCount: 2 });
    expect(summarized).toEqual(['2장']);
    expect(parseChapterSummariesMarkdown(saved[0] ?? '')).toEqual([
      { chapterTitle: '1장', summary: '먼저 쓴 요약' },
      { chapterTitle: '2장', summary: '2장 요약' },
    ]);
  });

  it('rewrites a chapter it already summarized rather than appending a duplicate', async () => {
    const existing = buildChapterSummariesMarkdown('작품', [
      { chapterTitle: '1장', summary: '재생성 전 요약' },
    ]);
    const { useCase, saved } = createUseCase(existing);

    await useCase.execute(workspaceUri, { chapterIndex: 0 });

    expect(parseChapterSummariesMarkdown(saved[0] ?? '')).toEqual([
      { chapterTitle: '1장', summary: '1장 요약' },
    ]);
  });

  it('reports a chapter index that names no chapter', async () => {
    const { useCase } = createUseCase();

    expect(await useCase.execute(workspaceUri, { chapterIndex: 9 })).toMatchObject({
      ok: false,
      kind: 'missing_drafts',
    });
  });

  it('stops on cancellation without saving', async () => {
    const { useCase, saved } = createUseCase();

    const result = await useCase.execute(workspaceUri, { shouldCancel: () => true });

    expect(result).toMatchObject({ ok: false, kind: 'cancelled' });
    expect(saved).toEqual([]);
  });
});
