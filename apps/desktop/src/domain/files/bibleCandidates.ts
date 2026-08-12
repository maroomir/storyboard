import {
  parseBibleCandidates,
  serializeBibleCandidates,
  type BibleCandidateRecord,
} from '@seedkernel/wasm';

export type { BibleCandidateRecord };
export { parseBibleCandidates, serializeBibleCandidates };

export interface BibleCandidateFileSystem {
  readonly readFile: (uri: unknown) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: unknown, content: Uint8Array) => PromiseLike<void>;
}

export async function readBibleCandidateFile(
  uri: unknown,
  fileSystem: BibleCandidateFileSystem,
): Promise<BibleCandidateRecord> {
  const bytes = await fileSystem.readFile(uri);
  return parseBibleCandidates(new TextDecoder().decode(bytes));
}

export async function writeBibleCandidateFile(
  uri: unknown,
  fileSystem: BibleCandidateFileSystem,
  record: BibleCandidateRecord,
): Promise<void> {
  await fileSystem.writeFile(uri, new TextEncoder().encode(serializeBibleCandidates(record)));
}
