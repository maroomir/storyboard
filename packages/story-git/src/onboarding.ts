import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { GitClient, type RepositoryBlocker } from './gitClient';

// The ignore block itself belongs to the workspace format, not to git: callers hand in the merge
// so this package stays dependency-free. Generated artifacts must be ignored BEFORE the first
// commit, otherwise the initial commit sweeps every draft into history.
export type GitignoreMerge = (current: string | undefined) => string | undefined;

export type OnboardingStatus =
  | 'ready'
  | 'needs-init'
  | 'needs-identity'
  | 'needs-initial-commit'
  | 'busy';

export interface OnboardingReport {
  readonly status: OnboardingStatus;
  readonly detail: string;
  readonly blocker?: RepositoryBlocker;
}

export interface OnboardingResult {
  readonly initialized: boolean;
  readonly gitignoreUpdated: boolean;
  readonly committed: boolean;
}

// Reports whether the workspace is ready to accept bot writes. Editing is blocked until this
// returns 'ready', because the write invariant is "a successful save is always a commit".
export function inspectWorkspaceRepository(workspaceRoot: string): OnboardingReport {
  const git = new GitClient(workspaceRoot);

  // NOTE: Identity is checked before the repository check because `git init` cannot supply it.
  // Reporting 'needs-init' first would send the user to /doctor init, whose commit then fails.
  if (!git.hasIdentity()) {
    return {
      status: 'needs-identity',
      detail:
        'git 사용자 정보(user.name / user.email)가 설정되어 있지 않아 커밋할 수 없습니다. `git config --global user.name` 과 `user.email` 을 설정해주세요.',
      blocker: 'no-identity',
    };
  }

  if (!git.isRepository()) {
    return {
      status: 'needs-init',
      detail:
        '이 워크스페이스는 아직 git 저장소가 아닙니다. 봇이 저장할 때마다 커밋을 남기려면 먼저 초기화가 필요합니다.',
      blocker: 'not-a-repository',
    };
  }

  const blocker = git.findBlocker();

  if (blocker !== undefined) {
    return { status: 'busy', detail: describeBlocker(blocker), blocker };
  }

  if (git.headCommit() === undefined) {
    return {
      status: 'needs-initial-commit',
      detail: '저장소에 커밋이 하나도 없습니다. 현재 워크스페이스 상태로 초기 커밋이 필요합니다.',
    };
  }

  return { status: 'ready', detail: '워크스페이스가 커밋 가능한 상태입니다.' };
}

export function describeBlocker(blocker: RepositoryBlocker): string {
  switch (blocker) {
    case 'not-a-repository':
      return '워크스페이스가 git 저장소가 아닙니다.';
    case 'no-identity':
      return 'git 사용자 정보(user.name / user.email)가 없습니다.';
    case 'index-locked':
      return '다른 git 작업이 진행 중입니다(.git/index.lock). 잠시 후 다시 시도해주세요.';
    case 'rebase-in-progress':
      return 'rebase가 진행 중입니다. Desktop에서 마무리한 뒤 다시 시도해주세요.';
    case 'merge-in-progress':
      return 'merge가 진행 중입니다. Desktop에서 마무리한 뒤 다시 시도해주세요.';
  }
}

// Brings an un-tracked workspace up to 'ready': init, ensure the ignore block, then commit the
// existing content as the baseline. Callers must confirm with the user first — this writes history.
export function initializeWorkspaceRepository(
  workspaceRoot: string,
  mergeGitignore: GitignoreMerge,
  options?: { readonly branch?: string; readonly initialCommitMessage?: string },
): OnboardingResult {
  const git = new GitClient(workspaceRoot);
  const initialized = !git.isRepository();

  if (initialized) {
    git.initRepository(options?.branch ?? 'main');
  }

  const gitignoreUpdated = ensureWorkspaceGitignore(workspaceRoot, mergeGitignore);

  const committed = git.commitAll(
    options?.initialCommitMessage ?? 'chore: Track Storyboard workspace',
  );

  return { initialized, gitignoreUpdated, committed };
}

// Writes what the merge returns. Returns whether the file was changed.
export function ensureWorkspaceGitignore(
  workspaceRoot: string,
  mergeGitignore: GitignoreMerge,
): boolean {
  const gitignorePath = join(workspaceRoot, '.gitignore');
  const current = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : undefined;
  const merged = mergeGitignore(current);

  if (merged === undefined) {
    return false;
  }

  writeFileSync(gitignorePath, merged, 'utf8');
  return true;
}
