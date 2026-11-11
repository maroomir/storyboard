import type { SqlRow } from '#engine/ports/sqlDatabase';
import type { CacheDatabase } from '#engine/persistence/cache/cacheDatabase';

export interface CachedChapterSummary {
  readonly threadId: string;
  readonly chapterId: string;
  readonly inputHash: string;
  readonly summary: string;
  readonly updatedAt: string;
}

export type SaveChapterSummaryRequest = Omit<CachedChapterSummary, 'updatedAt'>;

function toCachedChapterSummary(row: SqlRow): CachedChapterSummary {
  return {
    threadId: String(row.thread),
    chapterId: String(row.chapter),
    inputHash: String(row.input_hash),
    summary: String(row.summary),
    updatedAt: String(row.updated_at),
  };
}

export class ChapterSummaryStore {
  public constructor(
    private readonly database: CacheDatabase,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  public save(request: SaveChapterSummaryRequest): void {
    this.database.run(
      `INSERT OR REPLACE INTO chapter_summaries (thread, chapter, input_hash, summary, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        request.threadId,
        request.chapterId,
        request.inputHash,
        request.summary,
        this.now().toISOString(),
      ],
    );
  }

  public find(threadId: string, chapterId: string): CachedChapterSummary | undefined {
    const row: SqlRow | undefined = this.database.first(
      'SELECT * FROM chapter_summaries WHERE thread = ? AND chapter = ?',
      [threadId, chapterId],
    );

    return row === undefined ? undefined : toCachedChapterSummary(row);
  }

  public listThread(threadId: string): readonly CachedChapterSummary[] {
    return this.database
      .all('SELECT * FROM chapter_summaries WHERE thread = ? ORDER BY chapter', [threadId])
      .map(toCachedChapterSummary);
  }

  public listMissing(threadId: string, chapterIds: readonly string[]): readonly string[] {
    const cachedIds: ReadonlySet<string> = new Set(
      this.listThread(threadId).map((entry) => entry.chapterId),
    );
    return chapterIds.filter((chapterId) => !cachedIds.has(chapterId));
  }

  public remove(threadId: string, chapterId: string): void {
    this.database.run('DELETE FROM chapter_summaries WHERE thread = ? AND chapter = ?', [
      threadId,
      chapterId,
    ]);
  }
}
