import { describe, expect, it } from 'vitest';

import { createTheme, plainTheme, shouldUseColor } from '../src/terminal/theme';

const terminal = { isTty: true, env: {}, hasNoColorFlag: false, isJsonOutput: false };

describe('theme', () => {
  it('paints a role with its own reset so nested styles survive', () => {
    const theme = createTheme(true);

    expect(theme.paint('accent', 'scene')).toBe('\u001b[36mscene\u001b[39m');
    expect(theme.paint('heading', '기획')).toBe('\u001b[1m기획\u001b[22m');
  });

  it('leaves text untouched when color is off', () => {
    expect(plainTheme.paint('danger', '실패')).toBe('실패');
  });
});

describe('color conditions', () => {
  it('colors a person at a terminal', () => {
    expect(shouldUseColor(terminal)).toBe(true);
  });

  it('keeps pipes, --json, --no-color, NO_COLOR and dumb terminals plain', () => {
    expect(shouldUseColor({ ...terminal, isTty: false })).toBe(false);
    expect(shouldUseColor({ ...terminal, isJsonOutput: true })).toBe(false);
    expect(shouldUseColor({ ...terminal, hasNoColorFlag: true })).toBe(false);
    expect(shouldUseColor({ ...terminal, env: { NO_COLOR: '1' } })).toBe(false);
    expect(shouldUseColor({ ...terminal, env: { TERM: 'dumb' } })).toBe(false);
  });

  it('ignores an empty NO_COLOR, as the convention says', () => {
    expect(shouldUseColor({ ...terminal, env: { NO_COLOR: '' } })).toBe(true);
  });
});
