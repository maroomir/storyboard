import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export interface DraftKey {
  readonly genre: string;
  readonly pointLabel: string;
  readonly repeat: number;
}

export const simDraftsDirectory: string = 'drafts';

function pathSegment(text: string): string {
  return text.replace(/[^\p{L}\p{N}._-]/gu, '_');
}

export function draftsDirectoryFor(key: DraftKey): string {
  return join(simDraftsDirectory, pathSegment(key.genre), pathSegment(key.pointLabel), String(key.repeat));
}

export async function keepDrafts(
  outPath: string,
  key: DraftKey,
  drafts: ReadonlyMap<string, string>,
): Promise<string> {
  const resultsRoot: string = dirname(outPath);
  const directory: string = join(resultsRoot, draftsDirectoryFor(key));

  await mkdir(directory, { recursive: true });

  for (const [sceneStem, draft] of drafts) {
    await writeFile(join(directory, `${pathSegment(sceneStem)}.md`), draft, 'utf8');
  }

  return relative(resultsRoot, directory);
}
