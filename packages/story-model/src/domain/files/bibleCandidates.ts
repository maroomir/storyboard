import type { StoryUri } from '#model/format/storyUri';
import type { BibleFact } from '#model/format/bible';
import { z } from 'zod';

import { bibleFactSchema } from '#model/format/bible';

export interface BibleCandidateRecord {
  readonly sceneStem: string;
  readonly generatedAt: string;
  readonly facts: readonly BibleFact[];
}

export interface BibleCandidateFileSystem {
  readonly readFile: (uri: StoryUri) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: StoryUri, content: Uint8Array) => PromiseLike<void>;
}

const bibleCandidateRecordSchema = z.object({
  sceneStem: z.string().trim().min(1),
  generatedAt: z.string().datetime(),
  facts: z.array(bibleFactSchema),
});

export function serializeBibleCandidates(record: BibleCandidateRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

export function parseBibleCandidates(rawCandidates: string): BibleCandidateRecord {
  return bibleCandidateRecordSchema.parse(JSON.parse(rawCandidates));
}

export async function readBibleCandidateFile(
  uri: StoryUri,
  fileSystem: BibleCandidateFileSystem,
): Promise<BibleCandidateRecord> {
  const bytes = await fileSystem.readFile(uri);
  return parseBibleCandidates(new TextDecoder().decode(bytes));
}

export async function writeBibleCandidateFile(
  uri: StoryUri,
  fileSystem: BibleCandidateFileSystem,
  record: BibleCandidateRecord,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeBibleCandidates(record)));
}
