import fs from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import git, { type ReadCommitResult } from 'isomorphic-git';

import type { SnapshotEntry } from '@/shared/dto';

interface CommitAuthor {
  readonly name: string;
  readonly email: string;
}

const snapshotAuthor: CommitAuthor = { name: 'Storyboard Desktop', email: 'desktop@storyboard.local' };
const listLimit: number = 200;
const vanishedFileRetries: number = 5;

export interface SnapshotLocation {
  readonly repositoryRoot: string;
  readonly workspacePrefix: string;
}

type StatusRow = [string, number, number, number];

function toGitPath(path: string): string {
  return path.split(sep).join('/');
}

export async function locateSnapshotRepository(workspaceRoot: string): Promise<SnapshotLocation> {
  try {
    const repositoryRoot: string = await git.findRoot({ fs, filepath: workspaceRoot });
    return { repositoryRoot, workspacePrefix: toGitPath(relative(repositoryRoot, workspaceRoot)) };
  } catch {
    await git.init({ fs, dir: workspaceRoot, defaultBranch: 'main' });
    return { repositoryRoot: workspaceRoot, workspacePrefix: '' };
  }
}

function isStagedAsInHead([, head, , stage]: StatusRow): boolean {
  return head === 1 && stage === 1;
}

const atomicWriteLeftover: RegExp = /\.tmp-[0-9a-z]+$/;

function isAtomicWriteLeftover(filepath: string): boolean {
  return atomicWriteLeftover.test(filepath);
}

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

  public snapshot(message: string): Promise<string | undefined> {
    return this.serialize(() => this.commitChangesRetryingVanishedFiles(message));
  }

  public list(): Promise<SnapshotEntry[]> {
    return this.serialize(async () => {
      try {
        const commits: Array<ReadCommitResult> = await git.log({ fs, dir: this.location.repositoryRoot, depth: listLimit });
        return commits.map((entry) => ({
          id: entry.oid,
          message: entry.commit.message.trim().split('\n')[0] ?? '',
          time: new Date(entry.commit.author.timestamp * 1000).toISOString(),
        }));
      } catch {
        return [];
      }
    });
  }

  public restore(commitId: string, message: string): Promise<string | undefined> {
    return this.serialize(async () => {
      await this.commitChanges('되돌리기 전 자동 저장');

      const target: string[] = await this.listWorkspaceFiles(commitId);
      const current: string[] = await this.listWorkspaceFiles('HEAD');
      const targetSet: Set<string> = new Set(target);

      for (const filepath of target) {
        const { blob } = await git.readBlob({
          fs,
          dir: this.location.repositoryRoot,
          oid: commitId,
          filepath,
        });
        const absolute: string = join(this.location.repositoryRoot, filepath);
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
    const files: Array<string> = await git.listFiles({ fs, dir: this.location.repositoryRoot, ref });
    const prefix: string = this.location.workspacePrefix;

    return prefix === '' ? files : files.filter((file) => file.startsWith(`${prefix}/`));
  }

  private async commitChangesRetryingVanishedFiles(message: string): Promise<string | undefined> {
    for (let attempt: number = 1; ; attempt += 1) {
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
    const dir: string = this.location.repositoryRoot;
    const scope: { readonly filepaths?: string[] } = this.location.workspacePrefix === '' ? {} : { filepaths: [this.location.workspacePrefix] };

    for (const [filepath, , workdir] of (await git.statusMatrix({ fs, dir, ...scope })) as StatusRow[]) {
      if (isAtomicWriteLeftover(filepath)) {
        continue;
      }

      if (workdir === 0 || !(await stageFile(dir, filepath))) {
        await git.remove({ fs, dir, filepath });
      }
    }

    const staged: StatusRow[] = (await git.statusMatrix({ fs, dir, ...scope })) as StatusRow[];

    if (staged.every(isStagedAsInHead)) {
      return undefined;
    }

    return await git.commit({ fs, dir, message, author: snapshotAuthor });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next: Promise<T> = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }
}
