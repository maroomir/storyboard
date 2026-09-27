import fs from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import git from 'isomorphic-git';

import type { SnapshotEntry } from '@/shared/dto';

// NOTE: 작가는 git 을 모른다. 앱이 작품을 자동으로 커밋해 «이전 버전으로 되돌리기»를 주는 것이
// 데스크톱만의 예외다(CLI·확장은 커밋하지 않는다). isomorphic-git 을 쓰는 이유는 git 이 깔려 있지
// 않은 Windows·macOS 에서도 같은 저장소 형식을 만들기 위해서다. 사용자가 나중에 git 을 써도 그대로
// 읽힌다.
const snapshotAuthor = { name: 'Storyboard Desktop', email: 'desktop@storyboard.local' };
const listLimit = 200;
const vanishedFileRetries = 5;

export interface SnapshotLocation {
  readonly repositoryRoot: string;
  // The workspace's path inside the repository, '' when the workspace is the repository root.
  readonly workspacePrefix: string;
}

type StatusRow = [string, number, number, number];

function toGitPath(path: string): string {
  return path.split(sep).join('/');
}

export async function locateSnapshotRepository(workspaceRoot: string): Promise<SnapshotLocation> {
  try {
    const repositoryRoot = await git.findRoot({ fs, filepath: workspaceRoot });
    return { repositoryRoot, workspacePrefix: toGitPath(relative(repositoryRoot, workspaceRoot)) };
  } catch {
    await git.init({ fs, dir: workspaceRoot, defaultBranch: 'main' });
    return { repositoryRoot: workspaceRoot, workspacePrefix: '' };
  }
}

// Columns are [path, HEAD, WORKDIR, STAGE]. Once every file is staged, a file is unchanged exactly
// when its staged content is the one HEAD has.
function isStagedAsInHead([, head, , stage]: StatusRow): boolean {
  return head === 1 && stage === 1;
}

// NOTE: 원자적 쓰기는 옆에 임시 파일을 만들고 이름을 바꾼다. 생성이 돌며 쓰는 도중에 찍으면 그
// 임시 파일이 목록에 잡혔다가 사라지므로, 버전에 넣지 않고 사라진 파일은 지워진 것으로 다룬다.
const atomicWriteLeftover = /\.tmp-[0-9a-z]+$/;

function isAtomicWriteLeftover(filepath: string): boolean {
  return atomicWriteLeftover.test(filepath);
}

// isomorphic-git re-throws a file-system error from its tree walk without the `code`, so the
// message is the only reliable signal.
function isVanishedFileError(error: unknown): boolean {
  return (
    (error as NodeJS.ErrnoException).code === 'ENOENT' ||
    (error instanceof Error && error.message.includes('ENOENT'))
  );
}

async function stageFile(dir: string, filepath: string): Promise<boolean> {
  try {
    await git.add({ fs, dir, filepath });
    return true;
  } catch (error) {
    if (isVanishedFileError(error) || (error as { code?: string }).code === 'NotFoundError') {
      return false;
    }
    throw error;
  }
}

export class SnapshotService {
  private queue: Promise<unknown> = Promise.resolve();

  public constructor(private readonly location: SnapshotLocation) {}

  // Records the workspace as it is now. Returns undefined when nothing changed since the last one.
  public snapshot(message: string): Promise<string | undefined> {
    return this.serialize(() => this.commitChangesRetryingVanishedFiles(message));
  }

  public list(): Promise<SnapshotEntry[]> {
    return this.serialize(async () => {
      try {
        const commits = await git.log({ fs, dir: this.location.repositoryRoot, depth: listLimit });
        return commits.map((entry) => ({
          id: entry.oid,
          message: entry.commit.message.trim(),
          time: new Date(entry.commit.author.timestamp * 1000).toISOString(),
        }));
      } catch {
        // A repository with no commit yet has no HEAD to walk.
        return [];
      }
    });
  }

  // Puts every tracked file of the workspace back as it was in `commitId`, then records that as a new
  // snapshot. History is never rewritten: the state before the restore is snapshotted first, so a
  // restore can itself be undone.
  public restore(commitId: string, message: string): Promise<string | undefined> {
    return this.serialize(async () => {
      await this.commitChanges('되돌리기 전 자동 저장');

      const target = await this.listWorkspaceFiles(commitId);
      const current = await this.listWorkspaceFiles('HEAD');
      const targetSet = new Set(target);

      for (const filepath of target) {
        const { blob } = await git.readBlob({
          fs,
          dir: this.location.repositoryRoot,
          oid: commitId,
          filepath,
        });
        const absolute = join(this.location.repositoryRoot, filepath);
        await fs.promises.mkdir(dirname(absolute), { recursive: true });
        await fs.promises.writeFile(absolute, blob);
      }

      for (const filepath of current) {
        if (!targetSet.has(filepath)) {
          await fs.promises.rm(join(this.location.repositoryRoot, filepath), { force: true });
        }
      }

      return await this.commitChanges(message);
    });
  }

  private async listWorkspaceFiles(ref: string): Promise<string[]> {
    const files = await git.listFiles({ fs, dir: this.location.repositoryRoot, ref });
    const prefix = this.location.workspacePrefix;

    return prefix === '' ? files : files.filter((file) => file.startsWith(`${prefix}/`));
  }

  // NOTE: 상태 행렬은 무시 목록의 폴더까지 한 번 훑는다. 그 사이 생성 작업이 임시 파일을 이름 바꿔
  // 없애면 통째로 ENOENT 가 난다. 잠깐 쉬었다 다시 찍으면 새 파일로 보인다.
  private async commitChangesRetryingVanishedFiles(message: string): Promise<string | undefined> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.commitChanges(message);
      } catch (error) {
        if (!isVanishedFileError(error) || attempt >= vanishedFileRetries) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
      }
    }
  }

  private async commitChanges(message: string): Promise<string | undefined> {
    const dir = this.location.repositoryRoot;
    const scope = this.location.workspacePrefix === '' ? {} : { filepaths: [this.location.workspacePrefix] };

    // NOTE: 상태 행렬의 작업 트리 열은 파일 시각·크기가 색인과 같으면 내용을 보지 않는다. 자동 저장처럼
    // 같은 초 안에 길이가 같은 편집이 오면 «변경 없음»으로 잘못 나오므로, 모든 파일을 다시 올려
    // (내용 해시) 색인과 HEAD 를 비교한다.
    for (const [filepath, , workdir] of (await git.statusMatrix({ fs, dir, ...scope })) as StatusRow[]) {
      if (isAtomicWriteLeftover(filepath)) {
        continue;
      }

      if (workdir === 0 || !(await stageFile(dir, filepath))) {
        await git.remove({ fs, dir, filepath });
      }
    }

    const staged = (await git.statusMatrix({ fs, dir, ...scope })) as StatusRow[];

    if (staged.every(isStagedAsInHead)) {
      return undefined;
    }

    return await git.commit({ fs, dir, message, author: snapshotAuthor });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
