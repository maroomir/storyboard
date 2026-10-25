import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';

const graphemes: Intl.Segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const ellipsis: string = '…';
// eslint-disable-next-line no-control-regex -- a color code starts with ESC.
const colorCodePattern: RegExp = /(\u001b\[[0-9;]*m)/;

export function measureWidth(text: string): number {
  return stringWidth(text);
}

export function padEndToWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - measureWidth(text)));
}

export function truncateToWidth(text: string, width: number): string {
  if (measureWidth(text) <= width) {
    return text;
  }

  const room: number = width - measureWidth(ellipsis);
  let kept: string = '';
  let keptWidth: number = 0;
  let isFull: boolean = false;

  for (const part of text.split(colorCodePattern)) {
    if (colorCodePattern.test(part)) {
      kept += part;
      continue;
    }

    for (const { segment } of graphemes.segment(part)) {
      const segmentWidth: number = measureWidth(segment);

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

export function wrapWordsToWidth(text: string, width: number): string[] {
  return wrapAnsi(text, Math.max(1, width), { hard: false, trim: false })
    .split('\n')
    .map((line, index) => (index === 0 ? line : line.trimStart()));
}

export function wrapToWidth(text: string, width: number): string[] {
  return wrapAnsi(text, Math.max(1, width), { hard: true, trim: true }).split('\n');
}
