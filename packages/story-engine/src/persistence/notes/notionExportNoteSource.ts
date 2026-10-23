import {
  compareNoteNames,
  extractNoteTitle,
  stripMarkdownExtension,
  stripNotionIdSuffix,
  type NoteDocument,
  type SkippedNote,
  type StoryUri,
} from '@storyboard/story-model';

import {
  NoteSourceError,
  type CollectedNotes,
  type INoteSource,
} from '#engine/application/notes/noteSource';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { readZipEntries, ZipArchiveError, type ZipEntry } from './zipArchive';

export interface NotionExportNoteSourceOptions {
  readonly fileSystem: IFileSystem;
  // The «Markdown & CSV» zip Notion's export produces.
  readonly archive: StoryUri;
}

const macResourceForkDirectory = '__MACOSX/';

// Reads a Notion export zip: every page is a Markdown file named `Title <id>.md`, sub-pages sit in a
// folder of the same name, and a database comes as `Title <id>.csv` beside a folder of its row pages.
// Ids are stripped from titles and paths; a database CSV whose rows are pages of their own is left
// out, the rest become one note each. No link following — the export already holds the whole tree.
export class NotionExportNoteSource implements INoteSource {
  public readonly kind = 'notion-export' as const;

  public constructor(private readonly options: NotionExportNoteSourceOptions) {}

  public async collect(): Promise<CollectedNotes> {
    const { fileSystem, archive } = this.options;

    if (!(await fileSystem.exists(archive))) {
      throw new NoteSourceError('not-found', `노트를 찾을 수 없습니다: ${archive.fsPath}`);
    }

    let entries: ZipEntry[];
    try {
      entries = readZipEntries(await fileSystem.readFile(archive));
    } catch (error) {
      if (error instanceof ZipArchiveError) {
        throw new NoteSourceError('invalid-location', error.message, error);
      }
      throw error;
    }

    const files = entries
      .filter((entry) => !entry.name.startsWith(macResourceForkDirectory))
      .map((entry) => ({ entry, segments: entry.name.normalize('NFC').split('/') }))
      .sort((left, right) => compareNoteNames(left.entry.name, right.entry.name));
    const folderStems = new Set(
      files.flatMap(({ segments }) => segments.slice(0, -1).map(stripNotionIdSuffix)),
    );
    const notes: NoteDocument[] = [];
    const skipped: SkippedNote[] = [];
    const decoder = new TextDecoder();

    for (const { entry, segments } of files) {
      const fileName = segments.at(-1) ?? entry.name;
      const path = segments.slice(0, -1).map(stripNotionIdSuffix);
      const id = [...path, fileName.replace(/\s[0-9a-f]{32}(?=\.[a-z]+$)/i, '')].join('/');

      if (/\.md$/i.test(fileName)) {
        const body = decoder.decode(entry.data);
        const fallback = stripNotionIdSuffix(stripMarkdownExtension(fileName));
        notes.push({ id, title: extractNoteTitle(body, fallback), path, body, origin: 'tree' });
        continue;
      }

      if (/\.csv$/i.test(fileName)) {
        const stem = fileName.replace(/\.csv$/i, '');
        if (/_all$/i.test(stem) || folderStems.has(stripNotionIdSuffix(stem))) {
          continue;
        }
        const title = stripNotionIdSuffix(stem);
        notes.push({
          id,
          title,
          path,
          body: renderCsvAsNote(title, decoder.decode(entry.data)),
          origin: 'tree',
        });
        continue;
      }

      skipped.push({ label: id, reason: '노트가 아닌 파일이라 읽지 않았습니다' });
    }

    return { notes, skipped };
  }
}

// A database export is one table; each row becomes a heading with its properties, which reads like
// the page Notion would show for it.
export function renderCsvAsNote(title: string, csv: string): string {
  const rows = parseCsv(csv.replace(/^\uFEFF/, ''));
  const [header, ...records] = rows;

  if (header === undefined) {
    return `# ${title}\n`;
  }

  const sections = records
    .filter((record) => record.some((cell) => cell.trim().length > 0))
    .map((record) => {
      const [first, ...rest] = record;
      const properties = rest
        .map((cell, index) => ({ key: header[index + 1] ?? '', value: cell.trim() }))
        .filter(({ key, value }) => key.length > 0 && value.length > 0)
        .map(({ key, value }) => `- ${key}: ${value}`);
      return [`## ${(first ?? '').trim() || '제목 없음'}`, ...properties].join('\n');
    });

  return [`# ${title}`, ...sections].join('\n\n') + '\n';
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let isQuoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;

    if (isQuoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        isQuoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      isQuoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}
