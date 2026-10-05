import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';

// 터미널 칸 수는 글자 수가 아니다. 한글·한자는 2칸, 결합 문자는 0칸, 색 코드는 0칸이라
// `String.length`·`padEnd` 로 맞춘 열은 한글이 섞이는 순간 어긋난다.

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const ellipsis = '…';
// eslint-disable-next-line no-control-regex -- a color code starts with ESC.
const colorCodePattern = /(\u001b\[[0-9;]*m)/;

export function measureWidth(text: string): number {
  return stringWidth(text);
}

export function padEndToWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - measureWidth(text)));
}

// Cuts text so it fits, marking the cut with an ellipsis. Color codes take no room, and the ones
// after the cut are kept so every color that was opened is closed again.
export function truncateToWidth(text: string, width: number): string {
  if (measureWidth(text) <= width) {
    return text;
  }

  const room = width - measureWidth(ellipsis);
  let kept = '';
  let keptWidth = 0;
  let isFull = false;

  for (const part of text.split(colorCodePattern)) {
    if (colorCodePattern.test(part)) {
      kept += part;
      continue;
    }

    for (const { segment } of graphemes.segment(part)) {
      const segmentWidth = measureWidth(segment);

      if (isFull || keptWidth + segmentWidth > room) {
        isFull = true;
        break;
      }

      kept += segment;
      keptWidth += segmentWidth;
    }
  }

  return room < 0 ? '' : `${kept}${ellipsis}`;
}

// Breaks only at spaces, so a word or a path wider than the line stays whole (and stays one link)
// and the terminal wraps it.
export function wrapWordsToWidth(text: string, width: number): string[] {
  // Trimming the whole text would take a caller's indentation; only a wrapped line loses the space
  // it was broken at.
  return wrapAnsi(text, Math.max(1, width), { hard: false, trim: false })
    .split('\n')
    .map((line, index) => (index === 0 ? line : line.trimStart()));
}

// Breaks at spaces where it can and inside a word only when one word is wider than the line, so a
// long path still wraps instead of running off the screen. Color codes survive the break.
export function wrapToWidth(text: string, width: number): string[] {
  return wrapAnsi(text, Math.max(1, width), { hard: true, trim: true }).split('\n');
}
