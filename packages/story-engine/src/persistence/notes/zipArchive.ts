import { inflateRawSync } from 'node:zlib';

// The slice of the zip format a Notion export uses: a central directory of stored or deflated
// entries, no zip64, no encryption. Reading it here keeps the import free of a zip dependency.
export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

export type ZipArchiveErrorCode = 'not-a-zip' | 'unsupported-compression';

export class ZipArchiveError extends Error {
  public constructor(
    public readonly code: ZipArchiveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ZipArchiveError';
  }
}

const endOfCentralDirectorySignature: number = 0x06054b50;
const centralDirectoryEntrySignature: number = 0x02014b50;
const endRecordLength: number = 22;
const maximumCommentLength: number = 0xffff;

function findEndOfCentralDirectory(view: Buffer): number {
  const lowest: number = Math.max(0, view.length - endRecordLength - maximumCommentLength);

  for (let offset: number = view.length - endRecordLength; offset >= lowest; offset -= 1) {
    if (view.readUInt32LE(offset) === endOfCentralDirectorySignature) {
      return offset;
    }
  }

  throw new ZipArchiveError('not-a-zip', 'zip 파일이 아닙니다 (중앙 디렉터리를 찾지 못했습니다).');
}

export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view: Buffer<ArrayBufferLike> = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );

  if (view.length < endRecordLength) {
    throw new ZipArchiveError('not-a-zip', 'zip 파일이 아닙니다 (너무 짧습니다).');
  }

  const endRecord: number = findEndOfCentralDirectory(view);
  const entryCount: number = view.readUInt16LE(endRecord + 10);
  let cursor: number = view.readUInt32LE(endRecord + 16);
  const entries: ZipEntry[] = [];

  for (let index: number = 0; index < entryCount; index += 1) {
    if (cursor + 46 > view.length || view.readUInt32LE(cursor) !== centralDirectoryEntrySignature) {
      break;
    }

    const method: number = view.readUInt16LE(cursor + 10);
    const compressedSize: number = view.readUInt32LE(cursor + 20);
    const nameLength: number = view.readUInt16LE(cursor + 28);
    const extraLength: number = view.readUInt16LE(cursor + 30);
    const commentLength: number = view.readUInt16LE(cursor + 32);
    const localHeader: number = view.readUInt32LE(cursor + 42);
    const name: string = view.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) {
      continue;
    }

    const dataStart: number =
      localHeader + 30 + view.readUInt16LE(localHeader + 26) + view.readUInt16LE(localHeader + 28);
    const raw: Buffer<ArrayBufferLike> = view.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) {
      entries.push({ name, data: new Uint8Array(raw) });
    } else if (method === 8) {
      entries.push({ name, data: new Uint8Array(inflateRawSync(raw)) });
    } else {
      throw new ZipArchiveError(
        'unsupported-compression',
        `zip 항목 «${name}»의 압축 방식(${method})을 읽을 수 없습니다.`,
      );
    }
  }

  return entries;
}
