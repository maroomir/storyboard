import {
  compareNoteNames,
  extractNoteTitle,
  stripMarkdownExtension,
  stripNotionIdSuffix,
  type NoteDocument,
  type NoteSourceKind,
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

interface ZipNoteFile {
  readonly entry: ZipEntry;
  readonly segments: string[];
}

export interface NotionExportNoteSourceOptions {
  readonly fileSystem: IFileSystem;
  readonly archive: StoryUri;
}

const macResourceForkDirectory: string = '__MACOSX/';

export class NotionExportNoteSource implements INoteSource {
  public readonly kind: NoteSourceKind = 'notion-export';

  public constructor(private readonly options: NotionExportNoteSourceOptions) {}

  public async collect(): Promise<CollectedNotes> {
    const entries: ZipEntry[] = await this.readArchiveEntries();
    const files: ZipNoteFile[] = entries
      .filter((entry) => !entry.name.startsWith(macResourceForkDirectory))
      .map((entry): ZipNoteFile => ({ entry, segments: entry.name.normalize('NFC').split('/') }))
      .sort((left, right) => compareNoteNames(left.entry.name, right.entry.name));
    const folderStems: Set<string> = new Set(
      files.flatMap(({ segments }) => segments.slice(0, -1).map(stripNotionIdSuffix)),
    );
    const tally: ZipNoteTally = new ZipNoteTally();
    const decoder: InstanceType<typeof TextDecoder> = new TextDecoder();

    for (const file of files) {
      this.addZipNoteFile(file, folderStems, decoder, tally);
    }

    return tally.toCollectedNotes();
  }

  private async readArchiveEntries(): Promise<ZipEntry[]> {
    const { fileSystem, archive } = this.options;

    if (!(await fileSystem.exists(archive))) {
      throw new NoteSourceError('not-found', `노트를 찾을 수 없습니다: ${archive.fsPath}`);
    }

    try {
      return readZipEntries(await fileSystem.readFile(archive));
    } catch (error) {
      if (error instanceof ZipArchiveError) {
        throw new NoteSourceError('invalid-location', error.message, error);
      }
      throw error;
    }
  }

  private addZipNoteFile(
    file: ZipNoteFile,
    folderStems: ReadonlySet<string>,
    decoder: InstanceType<typeof TextDecoder>,
    tally: ZipNoteTally,
  ): void {
    const { entry, segments } = file;
    const fileName: string = segments.at(-1) ?? entry.name;
    const path: string[] = segments.slice(0, -1).map(stripNotionIdSuffix);
    const id: string = [...path, fileName.replace(/\s[0-9a-f]{32}(?=\.[a-z]+$)/i, '')].join('/');

    if (/\.md$/i.test(fileName)) {
      const body: string = decoder.decode(entry.data);
      const fallback: string = stripNotionIdSuffix(stripMarkdownExtension(fileName));
      tally.addNote({ id, title: extractNoteTitle(body, fallback), path, body, origin: 'tree' });
      return;
    }

    if (/\.csv$/i.test(fileName)) {
      const stem: string = fileName.replace(/\.csv$/i, '');
      if (/_all$/i.test(stem) || folderStems.has(stripNotionIdSuffix(stem))) {
        return;
      }
      const title: string = stripNotionIdSuffix(stem);
      tally.addNote({
        id,
        title,
        path,
        body: renderCsvAsNote(title, decoder.decode(entry.data)),
        origin: 'tree',
      });
      return;
    }

    tally.addSkipped({ label: id, reason: '노트가 아닌 파일이라 읽지 않았습니다' });
  }
}

class ZipNoteTally {
  private readonly notes: NoteDocument[] = [];
  private readonly skipped: SkippedNote[] = [];

  public addNote(note: NoteDocument): void {
    this.notes.push(note);
  }

  public addSkipped(skippedNote: SkippedNote): void {
    this.skipped.push(skippedNote);
  }

  public toCollectedNotes(): CollectedNotes {
    return { notes: this.notes, skipped: this.skipped };
  }
}

export function renderCsvAsNote(title: string, csv: string): string {
  const rows: string[][] = parseCsv(csv.replace(/^\uFEFF/, ''));
  const [header, ...records] = rows;

  if (header === undefined) {
    return `# ${title}\n`;
  }

  const sections: string[] = records
    .filter((record) => record.some((cell) => cell.trim().length > 0))
    .map((record) => {
      const [first, ...rest] = record;
      const properties: string[] = rest
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
  let cell: string = '';
  let isQuoted: boolean = false;

  for (let index: number = 0; index < text.length; index += 1) {
    const char: string = text[index] as string;

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
