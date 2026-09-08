import { execFileSync } from 'node:child_process';

export type GitRepositoryOutcome = 'initialized' | 'exists' | 'unavailable';

// SECURITY: git runs through execFileSync with an argument array and no shell, so the workspace
// path is never shell-interpreted.
function runGit(root: string, args: readonly string[]): boolean {
  try {
    execFileSync('git', [...args], { cwd: root, stdio: 'ignore', shell: false });
    return true;
  } catch {
    return false;
  }
}

export function isGitRepository(root: string): boolean {
  return runGit(root, ['rev-parse', '--is-inside-work-tree']);
}

// Creates the repository and nothing else: the first commit stays the user's, so `init` never
// writes history. `unavailable` means git could not run — the workspace is still usable without it.
export function ensureGitRepository(root: string): GitRepositoryOutcome {
  if (isGitRepository(root)) {
    return 'exists';
  }

  return runGit(root, ['init', '--initial-branch=main']) ? 'initialized' : 'unavailable';
}
