import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  NoteSourceError,
  NotionExportNoteSource,
  NotionNoteSource,
  ObsidianNoteSource,
  type NoteHttpFetch,
} from '@storyboard/story-engine';
import {
  canonicalNotionPageUrl,
  extractNoteLinkTargets,
  isNotionUrl,
  listNotionLinkedPageIds,
  parseNotionPageId,
  stripNotionIdSuffix,
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

  it('gives every address of one page the same location', () => {
    const id = '1429989fe8ac4effbc8f57f56486db54';
    const addresses = [
      `https://www.notion.so/team/Moon-Gate-${id}`,
      `https://www.notion.so/team/Renamed-Gate-${id}?pvs=4`,
      'https://www.notion.so/1429989f-e8ac-4eff-bc8f-57f56486db54',
      `https://app.notion.com/p/${id}?source=copy_link`,
    ];

    expect(new Set(addresses.map(canonicalNotionPageUrl))).toEqual(
      new Set([`https://www.notion.so/${id}`]),
    );
    expect(canonicalNotionPageUrl('https://www.notion.so/team/no-id-here')).toBe(
      'https://www.notion.so/team/no-id-here',
    );
  });
});

const rootId = '00000000000000000000000000000001';
const childId = '00000000000000000000000000000002';
const databaseId = '00000000000000000000000000000003';
const rowId = '00000000000000000000000000000004';
const linkedId = '00000000000000000000000000000005';
const unsharedId = '00000000000000000000000000000006';
const nestedBlockId = '00000000000000000000000000000007';
const tenthRowId = '00000000000000000000000000000008';
const ninthRowId = '00000000000000000000000000000009';

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
  [`GET /databases/${databaseId}`]: { object: 'database', id: databaseId, title: [text('인물 표')] },
  [`POST /databases/${databaseId}/query`]: list([
    page(rowId, '준', { 역할: { type: 'select', select: { name: '조력자' } } }),
    page(tenthRowId, '10 귀환'),
    page(ninthRowId, '9 등대'),
  ]),
  [`GET /blocks/${rowId}/children?page_size=100`]: list([]),
  [`GET /blocks/${tenthRowId}/children?page_size=100`]: list([]),
  [`GET /blocks/${ninthRowId}/children?page_size=100`]: list([]),
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

    if (route === `GET /pages/${databaseId}`) {
      return {
        status: 400,
        headers: { get: () => null },
        json: async () => ({
          code: 'validation_error',
          message: `Provided ID ${databaseId} is a database, not a page. Use the retrieve database API instead.`,
        }),
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

  it('reads sub-pages in page order and database rows in title order, then linked pages one step', async () => {
    const { fetch } = createNotionFetch();
    const source = new NotionNoteSource({ pageUrl, token: 'secret-token', fetch });

    const { notes, skipped } = await source.collect();

    expect(notes.map((note) => [note.title, note.origin, note.path])).toEqual([
      ['달의 문', 'tree', []],
      ['씬 메모', 'tree', ['달의 문']],
      ['9 등대', 'tree', ['달의 문', '인물 표']],
      ['10 귀환', 'tree', ['달의 문', '인물 표']],
      ['준', 'tree', ['달의 문', '인물 표']],
      ['세계관', 'link', []],
    ]);
    expect(notes[0]?.body).toBe('규칙은 세계관 참고.\n## 인물\n- 하나\n  - [x] 주인공');
    expect(notes[4]?.body).toBe('- 역할: 조력자');
    expect(notes[5]?.body).toBe('> 문은 만조에만 열린다.');
    expect(skipped.map((entry) => entry.label)).toEqual([unsharedId]);
  });

  it('reads the rows of a full-page database given as the root', async () => {
    const { fetch } = createNotionFetch();
    const source = new NotionNoteSource({
      pageUrl: `https://www.notion.so/team/${databaseId}?v=1`,
      token: 'secret-token',
      fetch,
    });

    const { notes } = await source.collect();

    expect(notes.map((note) => note.title)).toEqual(['9 등대', '10 귀환', '준']);
    expect(notes.every((note) => note.path.join() === '인물 표')).toBe(true);
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
    expect(notes).toHaveLength(6);
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

describe('NotionExportNoteSource', () => {
  const fileSystem = new NodeFileSystem();
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'storyboard-notion-export-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const pageId = '1429989fe8ac4effbc8f57f56486db54';
  const rowId = '2a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6';

  it('reads pages, strips ids from titles and paths, and turns a lone database into one note', async () => {
    const archive = join(directory, 'Export.zip');
    await writeFile(
      archive,
      buildZip([
        { name: `Export-abc/달의 문 ${pageId}.md`, text: '# 달의 문\n\n컨셉 메모.', isDeflated: true },
        { name: `Export-abc/달의 문 ${pageId}/인물 ${rowId}/하나 ${pageId}.md`, text: '# 하나\n\n등대지기.' },
        { name: `Export-abc/달의 문 ${pageId}/장소 ${rowId}.csv`, text: '﻿이름,분위기\n등대,"바람, 소금기"\n' },
        { name: `Export-abc/달의 문 ${pageId}/인물 ${rowId}.csv`, text: '이름,나이\n하나,19\n' },
        { name: `Export-abc/달의 문 ${pageId}/인물 ${rowId}_all.csv`, text: '이름,나이\n하나,19\n' },
        { name: `__MACOSX/Export-abc/._달의 문 ${pageId}.md`, text: 'junk' },
        { name: `Export-abc/지도 ${pageId}.png`, text: 'binary' },
      ]),
    );

    const { notes, skipped } = await new NotionExportNoteSource({ fileSystem, archive: NodeUri.file(archive) }).collect();

    expect(notes.map((note) => [note.id, note.title, note.path])).toEqual([
      ['Export-abc/달의 문.md', '달의 문', ['Export-abc']],
      ['Export-abc/달의 문/인물/하나.md', '하나', ['Export-abc', '달의 문', '인물']],
      ['Export-abc/달의 문/장소.csv', '장소', ['Export-abc', '달의 문']],
    ]);
    expect(notes[0]?.body).toBe('# 달의 문\n\n컨셉 메모.');
    expect(notes[2]?.body).toBe('# 장소\n\n## 등대\n- 분위기: 바람, 소금기\n');
    expect(skipped).toEqual([{ label: 'Export-abc/지도.png', reason: '노트가 아닌 파일이라 읽지 않았습니다' }]);
  });

  it('refuses a file that is not a zip', async () => {
    const archive = join(directory, 'notes.zip');
    await writeFile(archive, 'not a zip at all, just text that is long enough to scan');

    await expect(new NotionExportNoteSource({ fileSystem, archive: NodeUri.file(archive) }).collect()).rejects.toMatchObject({
      code: 'invalid-location',
    });
  });

  it('strips the id Notion appends to a title', () => {
    expect(stripNotionIdSuffix(`달의 문 ${pageId}`)).toBe('달의 문');
    expect(stripNotionIdSuffix('달의 문')).toBe('달의 문');
  });
});

function buildZip(files: readonly { name: string; text: string; isDeflated?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.text, 'utf8');
    const stored = file.isDeflated === true ? deflateRawSync(data) : data;
    const method = file.isDeflated === true ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, stored);
    centrals.push(central, name);
    offset += local.length + name.length + stored.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDirectory, end]);
}
