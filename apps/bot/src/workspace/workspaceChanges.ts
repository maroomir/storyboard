// A planned, already-validated set of file writes. Editors produce these; only the mutate gate
// applies them. `baselineHash` is the hash of the bytes the edit was derived from:
//   - a string  -> the file must still hash to exactly this, or the write is refused as stale
//   - undefined -> the file is expected NOT to exist yet (a create)
export interface WorkspaceWrite {
  readonly relativePath: string;
  readonly content: string;
  readonly baselineHash: string | undefined;
}

export interface WorkspaceChanges {
  readonly writes: readonly WorkspaceWrite[];
}

export interface WorkspacePlan {
  readonly changes: WorkspaceChanges;
  readonly commitMessage: string;
}

export type StaleReason = 'changed-on-disk' | 'deleted-on-disk' | 'already-exists';

export interface StaleFile {
  readonly relativePath: string;
  readonly reason: StaleReason;
}

export type MutateOutcome =
  | { readonly status: 'committed'; readonly paths: readonly string[] }
  | { readonly status: 'written'; readonly paths: readonly string[] }
  | { readonly status: 'commit-failed'; readonly paths: readonly string[] }
  | { readonly status: 'no-op' }
  | { readonly status: 'stale'; readonly files: readonly StaleFile[] }
  | { readonly status: 'blocked'; readonly detail: string };

export function describeStale(files: readonly StaleFile[]): string {
  const lines = files.map((file) => {
    switch (file.reason) {
      case 'changed-on-disk':
        return `• ${file.relativePath} — Desktop에서 변경되었습니다.`;
      case 'deleted-on-disk':
        return `• ${file.relativePath} — Desktop에서 삭제되었습니다.`;
      case 'already-exists':
        return `• ${file.relativePath} — 이미 존재합니다.`;
    }
  });

  return [
    '⚠️ 편집을 기준 시점 이후 내용이 바뀌어 저장하지 않았습니다.',
    ...lines,
    '다시 열어주세요.',
  ].join('\n');
}
