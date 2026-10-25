import { execFile, type ExecFileOptions } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run: (
  file: string,
  args: readonly string[],
  options: ExecFileOptions,
) => Promise<{ readonly stdout: string; readonly stderr: string }> = promisify(execFile);

export interface TrackRef {
  readonly root: string;
  readonly commit: string;
  readonly dirty: boolean;
}

export const simResultsDirectory: string = 'results';

const fixturePathspec: readonly string[] = ['--', '.', `:(exclude)${simResultsDirectory}`];

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await run('git', [...args], { cwd });
  return stdout.trim();
}

export async function describeTrack(root: string): Promise<TrackRef> {
  const commit: string = await git(root, ['rev-parse', 'HEAD']);
  const status: string = await git(root, ['status', '--porcelain', ...fixturePathspec]);

  return { root, commit, dirty: status.length > 0 };
}

export async function describeEngine(fromDirectory: string, fallback: string): Promise<string> {
  try {
    const commit: string = await git(fromDirectory, ['rev-parse', 'HEAD']);
    const status: string = await git(fromDirectory, [
      'status',
      '--porcelain',
      '--untracked-files=no',
    ]);

    return status.length > 0 ? `${commit}-dirty` : commit;
  } catch {
    return fallback;
  }
}

export async function copyToScratch(sourceDirectory: string): Promise<string> {
  const scratch: string = await mkdtemp(join(tmpdir(), 'storyboard-sim-'));
  const destination: string = join(scratch, 'workspace');

  await cp(sourceDirectory, destination, { recursive: true });
  return destination;
}

export async function removeScratch(scratchWorkspace: string): Promise<void> {
  await rm(join(scratchWorkspace, '..'), { recursive: true, force: true });
}

export type TrackMutatedErrorCode = 'track-mutated';

export class TrackMutatedError extends Error {
  public readonly code: TrackMutatedErrorCode = 'track-mutated';

  public constructor(root: string, changed: string) {
    super(
      `측정 중 트랙이 바뀌었습니다 (${root}). 기록한 커밋이 실제 입력을 설명하지 못하므로 이 회차는 버립니다.\n${changed}`,
    );
    this.name = 'TrackMutatedError';
  }
}

export async function assertTrackUnchanged(track: TrackRef): Promise<void> {
  const changed: string = await git(track.root, ['status', '--porcelain', ...fixturePathspec]);

  if (!track.dirty && changed.length > 0) {
    throw new TrackMutatedError(track.root, changed);
  }
}
