import { measureWidth } from './width';

export const storyboardWordmark: readonly string[] = [
  '█▀▀ ▀█▀ █▀█ █▀█ █ █ █▄▄ █▀█ ▄▀█ █▀█ █▀▄',
  '▄▄█  █  █▄█ █▀▄  █  █▄█ █▄█ █▀█ █▀▄ █▄▀',
];

const screenSidePaddingColumns: number = 4;

export const storyboardTagline: string = '장편 소설을 터미널에서';

export function canShowWordmark(columns: number): boolean {
  return columns >= Math.max(...storyboardWordmark.map(measureWidth)) + screenSidePaddingColumns;
}
