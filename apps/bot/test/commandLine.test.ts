import { describe, expect, it } from 'vitest';

import { parseCommandLine } from '../src/app/commandLine';

describe('parseCommandLine', () => {
  it('runs the bot with no arguments', () => {
    expect(parseCommandLine([])).toEqual({ kind: 'run' });
  });

  it.each([
    ['setup', 'setup'],
    ['doctor', 'doctor'],
    ['help', 'help'],
    ['--help', 'help'],
    ['-h', 'help'],
    ['--version', 'version'],
    ['-v', 'version'],
  ])('maps %s to %s', (argument, kind) => {
    expect(parseCommandLine([argument])).toEqual({ kind });
  });

  it('refuses an unknown command instead of starting the bot', () => {
    expect(parseCommandLine(['init'])).toEqual({ kind: 'unknown', argument: 'init' });
  });

  it('refuses a surplus argument after a known command', () => {
    expect(parseCommandLine(['setup', 'extra'])).toEqual({ kind: 'unknown', argument: 'extra' });
  });
});
