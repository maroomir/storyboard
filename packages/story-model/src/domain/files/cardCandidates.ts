import type { StoryUri } from '#model/format/storyUri';
import { cardCandidateRecordSchema, type CardCandidateRecord } from '#model/shared/cardCandidates';

export interface CardCandidateFileSystem {
  readonly readFile: (uri: StoryUri) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: StoryUri, content: Uint8Array) => PromiseLike<void>;
}

export function serializeCardCandidates(record: CardCandidateRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function parseCardCandidates(rawCandidates: string): CardCandidateRecord {
  return cardCandidateRecordSchema.parse(JSON.parse(rawCandidates));
}

export async function readCardCandidateFile(
  uri: StoryUri,
  fileSystem: CardCandidateFileSystem,
): Promise<CardCandidateRecord> {
  const bytes = await fileSystem.readFile(uri);
  return parseCardCandidates(new TextDecoder().decode(bytes));
}

export async function writeCardCandidateFile(
  uri: StoryUri,
  fileSystem: CardCandidateFileSystem,
  record: CardCandidateRecord,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeCardCandidates(record)));
}
