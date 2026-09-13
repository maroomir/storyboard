import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// NOTE: 생성은 시험체를 바꾼다. 실측으로 확인했다 — grounding 과 beats 가 씬 카드에 되쓰인다.
// 원본에서 돌리면 1회차가 2회차의 입력이 되고, 결과에 적은 트랙 해시가 실제 입력을 설명하지
// 못한다. 그래서 회차마다 사본에서 돌리고, 끝난 뒤 원본이 그대로인지 확인한다.

export interface TrackRef {
  readonly root: string;
  readonly commit: string;
  readonly dirty: boolean;
}

// 결과는 트랙 저장소 안에 쌓이지만 시험체가 아니다. 더러움 검사가 결과까지 보면 첫 실행이
// 두 번째 실행을 막는다. 이 디렉터리만 검사에서 뺀다.
export const simResultsDirectory = 'results';

const fixturePathspec: readonly string[] = ['--', '.', `:(exclude)${simResultsDirectory}`];

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run('git', [...args], { cwd });
  return stdout.trim();
}

export async function describeTrack(root: string): Promise<TrackRef> {
  const commit = await git(root, ['rev-parse', 'HEAD']);
  const status = await git(root, ['status', '--porcelain', ...fixturePathspec]);

  return { root, commit, dirty: status.length > 0 };
}

export async function copyToScratch(sourceDirectory: string): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), 'storyboard-sim-'));
  const destination = join(scratch, 'workspace');

  await cp(sourceDirectory, destination, { recursive: true });
  return destination;
}

export async function removeScratch(scratchWorkspace: string): Promise<void> {
  await rm(join(scratchWorkspace, '..'), { recursive: true, force: true });
}

export class TrackMutatedError extends Error {
  public readonly code = 'track-mutated';

  public constructor(root: string, changed: string) {
    super(
      `측정 중 트랙이 바뀌었습니다 (${root}). 기록한 커밋이 실제 입력을 설명하지 못하므로 이 회차는 버립니다.\n${changed}`,
    );
    this.name = 'TrackMutatedError';
  }
}

// 사본에서 돌렸는데도 원본이 움직였다면 어딘가 원본을 직접 쓰고 있다는 뜻이다.
export async function assertTrackUnchanged(track: TrackRef): Promise<void> {
  const changed = await git(track.root, ['status', '--porcelain', ...fixturePathspec]);

  if (!track.dirty && changed.length > 0) {
    throw new TrackMutatedError(track.root, changed);
  }
}
