import { STORYBOARD_RELATIVE_PATHS } from './paths';

export const storyboardGitignoreMarker: string = '# Storyboard generated files';

export const storyboardGitignoreEntries: readonly string[] = [
  `${STORYBOARD_RELATIVE_PATHS.cacheDirectory}/`,
  `${STORYBOARD_RELATIVE_PATHS.draftHistoryDirectory}/`,
  `${STORYBOARD_RELATIVE_PATHS.manuscriptDirectory}/`,
  STORYBOARD_RELATIVE_PATHS.sampleCharacterCard,
  STORYBOARD_RELATIVE_PATHS.sampleBackgroundCard,
  STORYBOARD_RELATIVE_PATHS.sampleScene,
];

export function readMissingGitignoreEntries(current: string | undefined): readonly string[] {
  if (current === undefined) {
    return storyboardGitignoreEntries;
  }

  const lines: Set<string> = new Set(current.split('\n').map((line) => line.trim()));

  return storyboardGitignoreEntries.filter((entry) => !lines.has(entry));
}

export function mergeStoryboardGitignore(current: string | undefined): string | undefined {
  const missing: readonly string[] = readMissingGitignoreEntries(current);

  if (missing.length === 0) {
    return undefined;
  }

  if (current === undefined || current.trim().length === 0) {
    return `${storyboardGitignoreMarker}\n${missing.join('\n')}\n`;
  }

  const separator: string = current.endsWith('\n') ? '' : '\n';
  const header: string = current.includes(storyboardGitignoreMarker)
    ? ''
    : `\n${storyboardGitignoreMarker}\n`;

  return `${current}${separator}${header}${missing.join('\n')}\n`;
}
