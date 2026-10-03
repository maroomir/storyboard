import {
  NoteSourceError,
  type CollectedNotes,
  type INoteSource,
} from '#engine/application/notes/noteSource';
import {
  asNotionRecord,
  listNotionChildren,
  listNotionLinkedPageIds,
  normalizeNotionId,
  notionPageTitle,
  notionRichText,
  parseNotionPageId,
  renderNotionBlocks,
  renderNotionProperties,
  type NotionBlockNode,
  type NotionRecord,
} from '@storyboard/story-model';
import type { NoteDocument, NoteOrigin, SkippedNote } from '@storyboard/story-model';

const notionApiBase = 'https://api.notion.com/v1';
const notionApiVersion = '2022-06-28';
const pageSize = 100;
const maximumRateLimitRetries = 5;
const untitledNoteTitle = '제목 없음';

// The shape of `fetch` this source needs. A host passes the platform's own; a test passes recorded
// responses.
export interface NoteHttpResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type NoteHttpFetch = (
  url: string,
  init: {
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
  },
) => Promise<NoteHttpResponse>;

export interface NotionNoteSourceOptions {
  readonly pageUrl: string;
  // SECURITY: the integration token is sent only to api.notion.com and never logged.
  readonly token: string;
  readonly fetch: NoteHttpFetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// Reads a Notion page and everything under it — sub-pages and the rows of inline databases, in
// page order — then the pages its text links to, one step and no further.
export class NotionNoteSource implements INoteSource {
  public readonly kind = 'notion' as const;

  private readonly notes: NoteDocument[] = [];
  private readonly skipped: SkippedNote[] = [];
  private readonly visitedIds = new Set<string>();
  private readonly linkedIds: string[] = [];

  public constructor(private readonly options: NotionNoteSourceOptions) {}

  public async collect(): Promise<CollectedNotes> {
    const rootId = parseNotionPageId(this.options.pageUrl);

    if (rootId === undefined) {
      throw new NoteSourceError(
        'invalid-location',
        `Notion 페이지 주소에서 페이지 id 를 찾지 못했습니다: ${this.options.pageUrl}`,
      );
    }

    this.notes.length = 0;
    this.skipped.length = 0;
    this.linkedIds.length = 0;
    this.visitedIds.clear();

    await this.visitRoot(rootId);

    for (const linkedId of this.linkedIds) {
      if (this.visitedIds.has(linkedId)) {
        continue;
      }

      // A linked page lives outside the tree that was shared, so the integration often cannot see
      // it. That is a note left out, not a failed run.
      try {
        await this.visitPage(linkedId, [], 'link');
      } catch (error) {
        this.skip(linkedId, error);
      }
    }

    return { notes: this.notes, skipped: this.skipped };
  }

  // The address may name a page or a full-page database; only asking tells them apart.
  private async visitRoot(rootId: string): Promise<void> {
    try {
      await this.visitPage(rootId, [], 'tree');
    } catch (error) {
      if (!(error instanceof NoteSourceError) || error.code !== 'not-found') {
        throw error;
      }

      this.visitedIds.delete(rootId);

      try {
        await this.visitDatabase(rootId, [], '');
      } catch {
        throw error;
      }
    }
  }

  private async visitPage(
    id: string,
    path: readonly string[],
    origin: NoteOrigin,
    loadedPage?: NotionRecord,
  ): Promise<void> {
    if (this.visitedIds.has(id)) {
      return;
    }

    this.visitedIds.add(id);

    const page = loadedPage ?? (await this.request('GET', `/pages/${id}`));
    const title = notionPageTitle(page) || untitledNoteTitle;
    const blocks = await this.loadBlockTree(id);
    const body = [renderNotionProperties(page), renderNotionBlocks(blocks)]
      .filter((part) => part.length > 0)
      .join('\n\n');

    this.notes.push({ id, title, path: [...path], body, origin });

    if (origin !== 'tree') {
      return;
    }

    this.linkedIds.push(...listNotionLinkedPageIds(blocks));

    for (const child of listNotionChildren(blocks)) {
      try {
        if (child.kind === 'page') {
          await this.visitPage(child.id, [...path, title], 'tree');
        } else {
          await this.visitDatabase(child.id, [...path, title], child.title);
        }
      } catch (error) {
        this.skip(child.title || child.id, error);
      }
    }
  }

  private async visitDatabase(
    id: string,
    path: readonly string[],
    knownTitle: string,
  ): Promise<void> {
    if (this.visitedIds.has(id)) {
      return;
    }

    this.visitedIds.add(id);

    const title =
      knownTitle ||
      notionRichText((await this.request('GET', `/databases/${id}`)).title).trim() ||
      untitledNoteTitle;

    for (const row of await this.listAll('POST', `/databases/${id}/query`)) {
      const rowId = typeof row.id === 'string' ? normalizeNotionId(row.id) : '';

      if (rowId.length === 0) {
        continue;
      }

      try {
        await this.visitPage(rowId, [...path, title], 'tree', row);
      } catch (error) {
        this.skip(notionPageTitle(row) || rowId, error);
      }
    }
  }

  private async loadBlockTree(blockId: string): Promise<NotionBlockNode[]> {
    const nodes: NotionBlockNode[] = [];

    for (const block of await this.listAll('GET', `/blocks/${blockId}/children`)) {
      const type = typeof block.type === 'string' ? block.type : '';
      const ownsNestedBlocks =
        block.has_children === true && type !== 'child_page' && type !== 'child_database';
      const children =
        ownsNestedBlocks && typeof block.id === 'string' ? await this.loadBlockTree(block.id) : [];

      nodes.push({ block, children });
    }

    return nodes;
  }

  private async listAll(method: 'GET' | 'POST', path: string): Promise<NotionRecord[]> {
    const results: NotionRecord[] = [];
    let cursor: string | undefined;

    do {
      const page =
        method === 'GET'
          ? await this.request(
              'GET',
              `${path}?page_size=${pageSize}${cursor === undefined ? '' : `&start_cursor=${encodeURIComponent(cursor)}`}`,
            )
          : await this.request('POST', path, {
              page_size: pageSize,
              ...(cursor === undefined ? {} : { start_cursor: cursor }),
            });

      for (const item of Array.isArray(page.results) ? page.results : []) {
        const record = asNotionRecord(item);

        if (record !== undefined) {
          results.push(record);
        }
      }

      cursor =
        page.has_more === true && typeof page.next_cursor === 'string'
          ? page.next_cursor
          : undefined;
    } while (cursor !== undefined);

    return results;
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body?: Readonly<Record<string, unknown>>,
  ): Promise<NotionRecord> {
    const sleep = this.options.sleep ?? defaultSleep;

    for (let attempt = 0; ; attempt += 1) {
      let response: NoteHttpResponse;

      try {
        response = await this.options.fetch(`${notionApiBase}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.options.token}`,
            'Notion-Version': notionApiVersion,
            'Content-Type': 'application/json',
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        throw new NoteSourceError('request-failed', 'Notion 에 연결하지 못했습니다.', error);
      }

      if (response.status === 429 && attempt < maximumRateLimitRetries) {
        const retryAfterSeconds = Number(response.headers.get('retry-after') ?? '1');
        await sleep((Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 1) * 1000);
        continue;
      }

      const payload = asNotionRecord(await response.json().catch(() => undefined)) ?? {};

      if (response.status >= 200 && response.status < 300) {
        return payload;
      }

      throw toNoteSourceError(response.status, payload);
    }
  }

  private skip(label: string, error: unknown): void {
    this.skipped.push({
      label,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

function toNoteSourceError(status: number, payload: NotionRecord): NoteSourceError {
  if (status === 401) {
    return new NoteSourceError(
      'unauthorized',
      'Notion 토큰이 거부되었습니다. storyboard notes connect notion 으로 다시 넣어 주세요.',
    );
  }

  if (status === 403 || status === 404) {
    return new NoteSourceError(
      'not-found',
      '페이지를 읽을 수 없습니다. Notion 에서 그 페이지의 「연결」에 통합을 추가했는지 확인해 주세요.',
    );
  }

  const detail = typeof payload.message === 'string' ? `: ${payload.message}` : '';

  return new NoteSourceError('request-failed', `Notion 요청이 실패했습니다 (${status})${detail}`);
}
