import { describe, expect, it } from 'vitest';

import { isScreenDrawing, keepTextAndColors } from '../src/terminal/controlCodes';

describe('keepTextAndColors', () => {
  it('drops cursor moves, screen clears and mode switches, keeping text and color', () => {
    const vimScreen =
      '\u001b[?1049h\u001b[?1h\u001b=\u001b[H\u001b[2J\u001b[?25l~\u001b[16;1HVIM - Vi IMproved' +
      '\u001b[23;2t\u001b]2;title\u0007\u001b[?1049l\u001b[?1l\u001b>\n\u001b[31m빨강\u001b[39m';

    const kept = keepTextAndColors(vimScreen);

    expect(kept).toBe('~VIM - Vi IMproved\n\u001b[31m빨강\u001b[39m');
  });

  it('keeps what a carriage return left last on a line', () => {
    expect(keepTextAndColors('10%\r50%\r100%\r\n끝\r\n')).toBe('100%\n끝\n');
  });
});

describe('isScreenDrawing', () => {
  it('tells a full-screen program from line output', () => {
    expect(isScreenDrawing('\u001b[2J\u001b[16;1HVIM - Vi IMproved')).toBe(true);
    expect(isScreenDrawing('\u001b[?1049h~')).toBe(true);
    expect(isScreenDrawing('\u001b[H목록')).toBe(true);
  });

  it('keeps progress lines and colored output as lines', () => {
    expect(isScreenDrawing('10%\r50%\r100%\n')).toBe(false);
    expect(isScreenDrawing('\u001b[32m수정함:\u001b[m  a.md\n\u001b[1;34mdir\u001b[0m')).toBe(
      false,
    );
    expect(isScreenDrawing('layer 1\n\u001b[1A\u001b[2Klayer 1 done\n')).toBe(false);
    expect(isScreenDrawing('⠙ 받는 중\r\u001b[J완료\n')).toBe(false);
  });
});
