import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

// The release job runs at the tag itself, where "the latest tag" is HEAD and the diff would be
// empty. The base is the newest `v*` tag that is an ancestor of HEAD without being HEAD.
export function resolveBaseRef(explicit) {
  if (explicit !== undefined && explicit !== '') {
    return explicit;
  }

  const head = git(['rev-parse', 'HEAD']);
  const tags = git(['tag', '--list', 'v*', '--sort=-v:refname']).split('\n').filter(Boolean);

  for (const tag of tags) {
    if (git(['rev-parse', `${tag}^{commit}`]) === head) {
      continue;
    }
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', tag, 'HEAD'], { cwd: repoRoot, stdio: 'ignore' });
      return tag;
    } catch {
      continue;
    }
  }

  throw new Error('No v* tag is an ancestor of HEAD; pass the base ref explicitly.');
}

export function listChangedFiles(baseRef) {
  const output = git(['diff', '--name-only', `${baseRef}..HEAD`]);
  return output === '' ? [] : output.split('\n');
}

export function readFileAt(ref, filePath) {
  try {
    return execFileSync('git', ['show', `${ref}:${filePath}`], { cwd: repoRoot, encoding: 'utf8' });
  } catch {
    return undefined;
  }
}

export function describeRange(baseRef) {
  return `${baseRef}..HEAD`;
}
