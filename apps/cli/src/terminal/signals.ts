import { pathToFileURL } from 'node:url';

const osc: string = '\u001b]';
const bell: string = '\u0007';

export const bellAfterRunLongerThanMs: number = 30_000;

export const bellSignal: string = bell;

export const pushWindowTitle: string = '\u001b[22;0t';
export const popWindowTitle: string = '\u001b[23;0t';

export function createWindowTitle(title: string): string {
  return `${osc}2;${title}${bell}`;
}

const absolutePathPattern: RegExp = /(^|[\s(:])(\/[^\s'"`()]*[^\s'"`().,;:])/gm;

export function linkFilePaths(text: string, isExistingPath: (path: string) => boolean): string {
  return text.replace(absolutePathPattern, (match, lead: string, path: string) =>
    isExistingPath(path)
      ? `${lead}${osc}8;;${pathToFileURL(path).href}${bell}${path}${osc}8;;${bell}`
      : match,
  );
}
