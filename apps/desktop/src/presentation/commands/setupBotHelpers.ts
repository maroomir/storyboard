export interface WorkspaceCandidate {
  readonly path: string;
  readonly hasProject: boolean;
}

export interface WorkspacePickOption {
  readonly label: string;
  readonly description: string;
  // A browse entry has no path: it opens a folder dialog instead of selecting a candidate.
  readonly path?: string;
  readonly needsInit: boolean;
}

export const BROWSE_FOLDER_LABEL = '폴더 직접 선택…';

// Folders that are not Storyboard projects yet stay in the list — the wizard offers to initialize
// them rather than hiding them, which is the whole point of "설치하면 알아서 되어야 한다".
export function buildWorkspacePickOptions(
  candidates: readonly WorkspaceCandidate[],
): WorkspacePickOption[] {
  const ready = candidates.filter((candidate) => candidate.hasProject);
  const uninitialized = candidates.filter((candidate) => !candidate.hasProject);

  return [
    ...ready.map((candidate) => ({
      label: candidate.path,
      description: 'Storyboard 워크스페이스',
      path: candidate.path,
      needsInit: false,
    })),
    ...uninitialized.map((candidate) => ({
      label: candidate.path,
      description: '초기화 필요 — 선택하면 Storyboard 프로젝트로 초기화합니다',
      path: candidate.path,
      needsInit: true,
    })),
    { label: BROWSE_FOLDER_LABEL, description: '다른 폴더에서 찾기', needsInit: false },
  ];
}
