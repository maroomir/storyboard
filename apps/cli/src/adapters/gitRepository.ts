import { execFileSync } from 'node:child_process';

export type GitRepositoryOutcome = 'initialized' | 'exists' | 'unavailable';

function runGitWithoutShell(root: string, args: readonly string[]): boolean {
  try {
    execFileSync('git', [...args], { cwd: root, stdio: 'ignore', shell: false });
    return true;
  } catch {
    return false;
  }
}

export function isGitRepository(root: string): boolean {
  return runGitWithoutShell(root, ['rev-parse', '--is-inside-work-tree']);
}

export function ensureGitRepository(root: string): GitRepositoryOutcome {
  if (isGitRepository(root)) {
    return 'exists';
  }

  return runGitWithoutShell(root, ['init', '--initial-branch=main'])
    ? 'initialized'
    : 'unavailable';
}
