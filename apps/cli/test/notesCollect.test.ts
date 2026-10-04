import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  NoteSourceError,
  NotionNoteSource,
  ObsidianNoteSource,
  type NoteHttpFetch,
} from '@storyboard/story-engine';
import {
  extractNoteLinkTargets,
  isNotionUrl,
  listNotionLinkedPageIds,
  parseNotionPageId,
  NodeUri,
} from '@storyboard/story-model';
import { NodeFileSystem } from '@storyboard/story-node';

const vault = join(__dirname, 'fixtures', 'notes', 'obsidianVault');

describe('note link targets', () => {
  it('reads wiki links and note links, and leaves embeds and web links out', () => {
    const body =
      '[[하나]] [[인물/준|준이]] [[세계관#조수]] ![[지도.png]] [표](표.md) [웹](https://example.com/a.md) [[하나]]';

    expect(extractNoteLinkTargets(body)).toEqual(['하나', '인물/준', '세계관', '표']);
  });
});

describe('ObsidianNoteSource', () => {
  const fileSystem = new NodeFileSystem();

  it('reads a folder in name order and follows links one step into the vault', async () => {
    const source = new ObsidianNoteSource({
      fileSystem,
      root: NodeUri.file(join(vault, '달의 문')),
    });

    const { notes, skipped } = await source.collect();

    expect(notes.map((note) => [note.id, note.origin])).toEqual([
      ['달의 문/씬/1 만조.md', 'tree'],
      ['달의 문/씬/2 등대의 밤.md', 'tree'],
      ['달의 문/씬/10 귀환.md', 'tree'],
      ['달의 문/인물/준.md', 'tree'],
      ['달의 문/인물/하나.md', 'tree'],
      ['달의 문/컨셉.md', 'tree'],
      ['세계관.md', 'link'],
    ]);
    expect(notes.find((note) => note.id === '달의 문/컨셉.md')?.title).toBe('달의 문 컨셉');
    expect(notes.find((note) => note.id === '달의 문/인물/하나.md')).toMatchObject({
      title: '하나',
      path: ['달의 문', '인물'],
    });
    // 세계관이 가리키는 「무관」은 두 단계째라 읽지 않는다.
    expect(notes.some((note) => note.id === '무관.md')).toBe(false);
    expect(skipped.map((entry) => entry.label)).toEqual(['없는 노트']);
  });

  it('reads a single note and the notes it links to', async () => {
    const source = new ObsidianNoteSource({
      fileSystem,
      root: NodeUri.file(join(vault, '달의 문', '인물', '하나.md')),
    });

    const { notes } = await source.collect();

    expect(notes.map((note) => [note.id, note.origin])).toEqual([
      ['달의 문/인물/하나.md', 'tree'],
      ['달의 문/인물/준.md', 'link'],
    ]);
  });

  it('refuses a path that does not exist', async () => {
    const source = new ObsidianNoteSource({
      fileSystem,
      root: NodeUri.file(join(vault, '없는 폴더')),
    });

    await expect(source.collect()).rejects.toMatchObject({ code: 'not-found' });
  });
});

describe('ObsidianNoteSource and symbolic links', () => {
  const fileSystem = new NodeFileSystem();
  let base: string;
  let vaultDirectory: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'storyboard-notes-'));
    vaultDirectory = join(base, 'vault');
    await mkdir(vaultDirectory);
    await mkdir(join(base, 'outside'));
    await writeFile(join(base, 'outside', 'secret.md'), 'SECRET-OUTSIDE-MARKER');
    await writeFile(join(vaultDirectory, 'villain.md'), '# 악역 준');
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  const collectVault = () =>
    new ObsidianNoteSource({ fileSystem, root: NodeUri.file(vaultDirectory) }).collect();

  it('skips a file link that points outside the vault and says why', async () => {
    await symlink(join('..', 'outside', 'secret.md'), join(vaultDirectory, 'leak.md'));

    const { notes, skipped } = await collectVault();

    expect(notes.map((note) => note.id)).toEqual(['villain.md']);
    expect(notes.some((note) => note.body.includes('SECRET-OUTSIDE-MARKER'))).toBe(false);
    expect(skipped).toEqual([{ label: 'leak.md', reason: expect.stringContaining('볼트 밖') }]);
  });

  it('does not walk a folder link that points outside the vault', async () => {
    await symlink(join('..', 'outside'), join(vaultDirectory, 'dirlink'));

    const { notes } = await collectVault();

    expect(notes.map((note) => note.id)).toEqual(['villain.md']);
  });

  it('does not follow a note link to a symbolic link that points outside the vault', async () => {
    await mkdir(join(vaultDirectory, '.obsidian'));
    await mkdir(join(vaultDirectory, '씬'));
    await writeFile(join(vaultDirectory, '씬', '1 시작.md'), '[[leak]]');
    await symlink(join('..', 'outside', 'secret.md'), join(vaultDirectory, 'leak.md'));

    const { notes, skipped } = await new ObsidianNoteSource({
      fileSystem,
      root: NodeUri.file(join(vaultDirectory, '씬')),
    }).collect();

    expect(notes.map((note) => note.id)).toEqual(['씬/1 시작.md']);
    expect(skipped).toEqual([{ label: 'leak.md', reason: expect.stringContaining('볼트 밖') }]);
  });

  it('reads a link that stays inside the vault', async () => {
    await symlink('villain.md', join(vaultDirectory, 'alias.md'));

    const { notes, skipped } = await collectVault();

    expect(notes.map((note) => note.id)).toEqual(['alias.md', 'villain.md']);
    expect(skipped).toEqual([]);
  });
});

describe('parseNotionPageId', () => {
  it('finds the id in a titled link, a bare id and a database peek', () => {
    const id = '1429989fe8ac4effbc8f57f56486db54';

    expect(parseNotionPageId(`https://www.notion.so/team/Moon-Gate-${id}`)).toBe(id);
    expect(
      parseNotionPageId('https://www.notion.so/1429989f-e8ac-4eff-bc8f-57f56486db54?pvs=4'),
    ).toBe(id);
    expect(
      parseNotionPageId(`https://www.notion.so/team/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?v=1&p=${id}`),
    ).toBe(id);
    expect(parseNotionPageId('https://www.notion.so/team/no-id-here')).toBeUndefined();
  });

  it('reads the app.notion.com address that 「링크 복사」 hands out', () => {
    const id = '1429989fe8ac4effbc8f57f56486db54';
    const copiedLink = `https://app.notion.com/p/${id}?source=copy_link`;

    expect(isNotionUrl(copiedLink)).toBe(true);
    expect(parseNotionPageId(copiedLink)).toBe(id);
    expect(isNotionUrl('https://notion.example.com/p/x')).toBe(false);
  });

  it('follows an app.notion.com link written in the text', () => {
    const id = '1429989fe8ac4effbc8f57f56486db54';
    const block = {
      type: 'paragraph',
      paragraph: {
        rich_text: [{ type: 'text', plain_text: '세계관', href: `https://app.notion.com/p/${id}` }],
      },
    };

    expect(listNotionLinkedPageIds([{ block, children: [] }])).toEqual([id]);
  });
});

const rootId = '00000000000000000000000000000001';
const childId = '00000000000000000000000000000002';
const databaseId = '00000000000000000000000000000003';
const rowId = '00000000000000000000000000000004';
const linkedId = '00000000000000000000000000000005';
const unsharedId = '00000000000000000000000000000006';
const nestedBlockId = '00000000000000000000000000000007';

function text(plainText: string): Record<string, unknown> {
  return { type: 'text', plain_text: plainText, href: null };
}

function page(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    object: 'page',
    id,
    properties: { 이름: { type: 'title', title: [text(title)] }, ...extra },
  };
}

function list(results: unknown[], nextCursor?: string) {
  return { results, has_more: nextCursor !== undefined, next_cursor: nextCursor ?? null };
}

const notionRoutes: Record<string, unknown> = {
  [`GET /pages/${rootId}`]: page(rootId, '달의 문'),
  [`GET /blocks/${rootId}/children?page_size=100`]: list(
    [
      {
        id: 'b1',
        type: 'paragraph',
        has_children: false,
        paragraph: {
          rich_text: [
            text('규칙은 '),
            {
              type: 'mention',
              plain_text: '세계관',
              mention: { type: 'page', page: { id: linkedId } },
            },
            text(' 참고.'),
          ],
        },
      },
      {
        id: 'b2',
        type: 'heading_2',
        has_children: false,
        heading_2: { rich_text: [text('인물')] },
      },
    ],
    'cursor-2',
  ),
  [`GET /blocks/${rootId}/children?page_size=100&start_cursor=cursor-2`]: list([
    {
      id: nestedBlockId,
      type: 'bulleted_list_item',
      has_children: true,
      bulleted_list_item: { rich_text: [text('하나')] },
    },
    { id: childId, type: 'child_page', has_children: true, child_page: { title: '씬 메모' } },
    {
      id: databaseId,
      type: 'child_database',
      has_children: false,
      child_database: { title: '인물 표' },
    },
    { id: 'b6', type: 'link_to_page', link_to_page: { type: 'page_id', page_id: unsharedId } },
  ]),
  [`GET /blocks/${nestedBlockId}/children?page_size=100`]: list([
    {
      id: 'b3a',
      type: 'to_do',
      has_children: false,
      to_do: { rich_text: [text('주인공')], checked: true },
    },
  ]),
  [`GET /pages/${childId}`]: page(childId, '씬 메모'),
  [`GET /blocks/${childId}/children?page_size=100`]: list([
    {
      id: 'c1',
      type: 'paragraph',
      has_children: false,
      paragraph: { rich_text: [text('만조의 밤.')] },
    },
  ]),
  [`POST /databases/${databaseId}/query`]: list([
    page(rowId, '준', { 역할: { type: 'select', select: { name: '조력자' } } }),
  ]),
  [`GET /blocks/${rowId}/children?page_size=100`]: list([]),
  [`GET /pages/${linkedId}`]: page(linkedId, '세계관'),
  [`GET /blocks/${linkedId}/children?page_size=100`]: list([
    {
      id: 'l1',
      type: 'quote',
      has_children: false,
      quote: { rich_text: [text('문은 만조에만 열린다.')] },
    },
    { id: 'l2', type: 'child_page', has_children: false, child_page: { title: '더 깊은 페이지' } },
  ]),
};

function createNotionFetch(options: { rateLimitOnce?: string } = {}): {
  fetch: NoteHttpFetch;
  calls: string[];
} {
  const calls: string[] = [];
  let hasRateLimited = false;

  const fetch: NoteHttpFetch = async (url, init) => {
    const route = `${init.method} ${url.replace('https://api.notion.com/v1', '')}`;
    calls.push(route);

    if (init.headers.Authorization !== 'Bearer secret-token') {
      return { status: 401, headers: { get: () => null }, json: async () => ({}) };
    }

    if (options.rateLimitOnce === route && !hasRateLimited) {
      hasRateLimited = true;
      return {
        status: 429,
        headers: { get: (name) => (name === 'retry-after' ? '2' : null) },
        json: async () => ({}),
      };
    }

    const body = notionRoutes[route];

    return body === undefined
      ? { status: 404, headers: { get: () => null }, json: async () => ({ message: 'not found' }) }
      : { status: 200, headers: { get: () => null }, json: async () => body };
  };

  return { fetch, calls };
}

describe('NotionNoteSource', () => {
  const pageUrl = `https://www.notion.so/team/Moon-Gate-${rootId}`;

  it('reads sub-pages and database rows in page order, then linked pages one step', async () => {
    const { fetch } = createNotionFetch();
    const source = new NotionNoteSource({ pageUrl, token: 'secret-token', fetch });

    const { notes, skipped } = await source.collect();

    expect(notes.map((note) => [note.title, note.origin, note.path])).toEqual([
      ['달의 문', 'tree', []],
      ['씬 메모', 'tree', ['달의 문']],
      ['준', 'tree', ['달의 문', '인물 표']],
      ['세계관', 'link', []],
    ]);
    expect(notes[0]?.body).toBe('규칙은 세계관 참고.\n## 인물\n- 하나\n  - [x] 주인공');
    expect(notes[2]?.body).toBe('- 역할: 조력자');
    expect(notes[3]?.body).toBe('> 문은 만조에만 열린다.');
    // 공유되지 않은 링크는 실패가 아니라 빠진 노트다.
    expect(skipped.map((entry) => entry.label)).toEqual([unsharedId]);
  });

  it('waits out a rate limit and retries', async () => {
    const { fetch } = createNotionFetch({ rateLimitOnce: `GET /pages/${rootId}` });
    const waits: number[] = [];
    const source = new NotionNoteSource({
      pageUrl,
      token: 'secret-token',
      fetch,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    const { notes } = await source.collect();

    expect(waits).toEqual([2000]);
    expect(notes).toHaveLength(4);
  });

  it('reports a rejected token and an unreadable root page as typed errors', async () => {
    const rejected = new NotionNoteSource({
      pageUrl,
      token: 'wrong',
      fetch: createNotionFetch().fetch,
    });
    await expect(rejected.collect()).rejects.toMatchObject({ code: 'unauthorized' });

    const missing = new NotionNoteSource({
      pageUrl: `https://www.notion.so/${unsharedId}`,
      token: 'secret-token',
      fetch: createNotionFetch().fetch,
    });
    await expect(missing.collect()).rejects.toBeInstanceOf(NoteSourceError);
    await expect(missing.collect()).rejects.toMatchObject({ code: 'not-found' });

    const malformed = new NotionNoteSource({
      pageUrl: 'https://www.notion.so/team/no-id',
      token: 'secret-token',
      fetch: createNotionFetch().fetch,
    });
    await expect(malformed.collect()).rejects.toMatchObject({ code: 'invalid-location' });
  });
});
