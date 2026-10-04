import { pathToFileURL } from 'node:url';

// 터미널에 보내는 OSC 신호: 창 제목, 클릭할 수 있는 파일 경로, 끝났다는 벨. 지원하지 않는 터미널은
// OSC 를 그냥 삼키므로 화면이 깨지지 않는다. 그래도 사람이 보는 터미널에만 보낸다.

const osc = '\u001b]';
const bell = '\u0007';

// A run this long has usually lost the author's attention to another window.
export const longRunMilliseconds = 30_000;

export const bellSignal = bell;

// xterm's title stack, so the title the shell had comes back when the run ends.
export const pushWindowTitle = '\u001b[22;0t';
export const popWindowTitle = '\u001b[23;0t';

export function createWindowTitle(title: string): string {
  return `${osc}2;${title}${bell}`;
}

// An absolute path after a space, a parenthesis or a colon; trailing sentence punctuation is not
// part of it.
const absolutePathPattern = /(^|[\s(:])(\/[^\s'"`()]*[^\s'"`().,;:])/gm;

// Turns each absolute path that exists into an OSC 8 link, so a terminal that supports it opens the
// file on click. The visible text is unchanged.
export function linkFilePaths(text: string, isExistingPath: (path: string) => boolean): string {
  return text.replace(absolutePathPattern, (match, lead: string, path: string) =>
    isExistingPath(path)
      ? `${lead}${osc}8;;${pathToFileURL(path).href}${bell}${path}${osc}8;;${bell}`
      : match,
  );
}
