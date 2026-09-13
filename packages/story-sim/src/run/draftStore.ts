import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

// NOTE: 생성은 사본에서 돌고 사본은 회차가 끝나면 지워진다. 그래서 심판이 회차를 버리면 «심판이
// 옳았는가, 원고가 정말 그만큼 나빴는가» 를 가릴 길이 없었다. 실측에서 그 일이 있었다 — 하한선
// 관문이 생성본을 훼손본 아래로 밀었는데, 원고가 없으니 심판 탓인지 원고 탓인지 알 수 없었다.
// 원고는 결과 파일 곁에 남긴다. 결과 디렉터리는 시험체가 아니므로 더러움 검사에 걸리지 않는다.

export interface DraftKey {
  readonly genre: string;
  readonly pointLabel: string;
  readonly repeat: number;
}

export const simDraftsDirectory = 'drafts';

// 지점 이름에는 `grid:0120` 처럼 경로에 못 쓰는 글자가 섞인다.
function pathSegment(text: string): string {
  return text.replace(/[^\p{L}\p{N}._-]/gu, '_');
}

// 결과 파일이 있는 디렉터리 기준의 상대 경로. 기록에는 이것을 적는다.
export function draftsDirectoryFor(key: DraftKey): string {
  return join(simDraftsDirectory, pathSegment(key.genre), pathSegment(key.pointLabel), String(key.repeat));
}

export async function keepDrafts(
  outPath: string,
  key: DraftKey,
  drafts: ReadonlyMap<string, string>,
): Promise<string> {
  const resultsRoot = dirname(outPath);
  const directory = join(resultsRoot, draftsDirectoryFor(key));

  await mkdir(directory, { recursive: true });

  for (const [sceneStem, draft] of drafts) {
    await writeFile(join(directory, `${pathSegment(sceneStem)}.md`), draft, 'utf8');
  }

  return relative(resultsRoot, directory);
}
