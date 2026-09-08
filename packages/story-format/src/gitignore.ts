// The block Storyboard writes into a workspace .gitignore. Every writer (extension init, CLI init)
// and the CLI doctor read this one list, so a new generated artefact is added here
// and nowhere else. Generated artifacts must be ignored BEFORE the first commit, otherwise the
// initial commit sweeps every draft into history.
export const storyboardGitignoreMarker = '# Storyboard generated files';

export const storyboardGitignoreEntries = [
  '.storyboard/cache/',
  '.draft/',
  'manuscript/',
  'character/.sample.card',
  'background/.sample.card',
  'scene/.sample.card',
] as const;

export function readMissingGitignoreEntries(current: string | undefined): readonly string[] {
  if (current === undefined) {
    return storyboardGitignoreEntries;
  }

  const lines = new Set(current.split('\n').map((line) => line.trim()));

  return storyboardGitignoreEntries.filter((entry) => !lines.has(entry));
}

// Returns the content to write, or undefined when the file already carries every entry.
// NOTE: 마커가 있다는 것만으로 넘어가면 0.8 이전 워크스페이스에 `manuscript/`가 영영 추가되지
// 않아 생성물이 통째로 커밋 대상에 남는다. 빠진 항목만 이어 붙인다.
export function mergeStoryboardGitignore(current: string | undefined): string | undefined {
  const missing = readMissingGitignoreEntries(current);

  if (missing.length === 0) {
    return undefined;
  }

  if (current === undefined || current.trim().length === 0) {
    return `${storyboardGitignoreMarker}\n${missing.join('\n')}\n`;
  }

  const separator = current.endsWith('\n') ? '' : '\n';
  const header = current.includes(storyboardGitignoreMarker)
    ? ''
    : `\n${storyboardGitignoreMarker}\n`;

  return `${current}${separator}${header}${missing.join('\n')}\n`;
}
