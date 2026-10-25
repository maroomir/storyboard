import type { ReadWriteFileSystem } from '#model/format/files/readWriteFileSystem';
import type { StoryUri } from '#model/format/storyUri';
import { cardCandidateRecordSchema, type CardCandidateRecord } from '#model/shared/cardCandidates';

export function serializeCardCandidates(record: CardCandidateRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function parseCardCandidates(rawCandidates: string): CardCandidateRecord {
  return cardCandidateRecordSchema.parse(JSON.parse(rawCandidates));
}

export async function readCardCandidateFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
): Promise<CardCandidateRecord> {
  const bytes: Uint8Array<ArrayBufferLike> = await fileSystem.readFile(uri);
  return parseCardCandidates(new TextDecoder().decode(bytes));
}

export async function writeCardCandidateFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
  record: CardCandidateRecord,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeCardCandidates(record)));
}
