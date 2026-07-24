import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { GitClient, type RepositoryBlocker } from './gitClient';

// The block Storyboard writes into a workspace .gitignore. Generated artifacts must be ignored
// BEFORE the first commit, otherwise the initial commit sweeps every draft into history.
const STORYBOARD_GITIGNORE_BLOCK = `
# Storyboard generated files
.storyboard/cache/
draft/
.draft/
manuscript/
character/.sample.card
background/.sample.card
scene/.sample.txt
`;

const GITIGNORE_MARKER = '# Storyboard generated files';

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

  if (!git.isRepository()) {
    return {
      status: 'needs-init',
      detail:
        '이 워크스페이스는 아직 git 저장소가 아닙니다. 봇이 저장할 때마다 커밋을 남기려면 먼저 초기화가 필요합니다.',
      blocker: 'not-a-repository',
    };
  }

  const blocker = git.findBlocker();

  if (blocker === 'no-identity') {
    return {
      status: 'needs-identity',
      detail:
        'git 사용자 정보(user.name / user.email)가 설정되어 있지 않아 커밋할 수 없습니다. `git config --global user.name` 과 `user.email` 을 설정해주세요.',
      blocker,
    };
  }

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
  options?: { readonly branch?: string; readonly initialCommitMessage?: string },
): OnboardingResult {
  const git = new GitClient(workspaceRoot);
  const initialized = !git.isRepository();

  if (initialized) {
    git.initRepository(options?.branch ?? 'main');
  }

  const gitignoreUpdated = ensureWorkspaceGitignore(workspaceRoot);

  const committed = git.commitAll(
    options?.initialCommitMessage ?? 'chore: Track Storyboard workspace',
  );

  return { initialized, gitignoreUpdated, committed };
}

// Appends the Storyboard ignore block when absent. Returns whether the file was changed.
export function ensureWorkspaceGitignore(workspaceRoot: string): boolean {
  const gitignorePath = join(workspaceRoot, '.gitignore');

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, STORYBOARD_GITIGNORE_BLOCK.trimStart(), 'utf8');
    return true;
  }

  const current = readFileSync(gitignorePath, 'utf8');
  if (current.includes(GITIGNORE_MARKER)) {
    return false;
  }

  const separator = current.endsWith('\n') ? '' : '\n';
  writeFileSync(gitignorePath, `${current}${separator}${STORYBOARD_GITIGNORE_BLOCK}`, 'utf8');
  return true;
}
