import type { StoryUri } from '#model/format/storyUri';
import type { BibleFact } from '#model/format/bible';
import { z } from 'zod';

import { bibleFactSchema } from '#model/format/bible';
import type { ReadWriteFileSystem } from '#model/format/files/readWriteFileSystem';

export interface BibleCandidateRecord {
  readonly sceneStem: string;
  readonly generatedAt: string;
  readonly facts: readonly BibleFact[];
}

const bibleCandidateRecordSchema: z.ZodType<BibleCandidateRecord> = z.object({
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
  fileSystem: ReadWriteFileSystem,
): Promise<BibleCandidateRecord> {
  const bytes: Uint8Array<ArrayBufferLike> = await fileSystem.readFile(uri);
  return parseBibleCandidates(new TextDecoder().decode(bytes));
}

export async function writeBibleCandidateFile(
  uri: StoryUri,
  fileSystem: ReadWriteFileSystem,
  record: BibleCandidateRecord,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeBibleCandidates(record)));
}
