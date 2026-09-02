import { describe, expect, it } from 'vitest';

import { flagBoolean, isParseFailure, parseArguments, resolveVerb } from '../src/cliArguments';

describe('parseArguments', () => {
  it('honours -h and -v as the long flags', () => {
    const help = parseArguments(['-h']);
    const version = parseArguments(['-v']);

    expect(!isParseFailure(help) && flagBoolean(help.flags, 'help')).toBe(true);
    expect(!isParseFailure(version) && flagBoolean(version.flags, 'version')).toBe(true);
  });

  it('keeps a boolean flag from swallowing the next token', () => {
    const parsed = parseArguments(['scene', 'generate', '--json', '01-a']);

    expect(isParseFailure(parsed)).toBe(false);
    if (!isParseFailure(parsed)) {
      expect(parsed.words).toEqual(['scene', 'generate', '01-a']);
      expect(parsed.flags['json']).toBe(true);
    }
  });

  it('rejects a flag the catalog does not list', () => {
    const parsed = parseArguments(['--resume']);

    expect(isParseFailure(parsed)).toBe(true);
  });

  it('resolves the longest verb the table knows', () => {
    const parsed = parseArguments(['card', 'create', 'character', '--name', '서린']);
    if (isParseFailure(parsed)) {
      throw new Error('unexpected parse failure');
    }

    const resolved = resolveVerb(parsed, ['card create character', 'card create background']);

    expect(resolved.path).toEqual(['card', 'create', 'character']);
    expect(resolved.positionals).toEqual([]);
    expect(resolved.flags['name']).toBe('서린');
  });
});
