import { measureWidth } from './width';

// 대화형 화면 맨 위의 워드마크. 블록 문자 두 줄로 STORYBOARD 를 쓴다.
export const storyboardWordmark: readonly string[] = [
  '█▀▀ ▀█▀ █▀█ █▀█ █ █ █▄▄ █▀█ ▄▀█ █▀█ █▀▄',
  '▄▄█  █  █▄█ █▀▄  █  █▄█ █▄█ █▀█ █▀▄ █▄▀',
];

export const storyboardTagline = '장편 소설을 터미널에서';

// The mark plus the screen's side padding; narrower than this it would wrap into noise.
export function canShowWordmark(columns: number): boolean {
  return columns >= Math.max(...storyboardWordmark.map(measureWidth)) + 4;
}
