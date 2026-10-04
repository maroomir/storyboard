import { booleanFlagNames, valueFlagNames } from './commands/catalog';

export interface ParsedArguments {
  readonly path: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly positionals: readonly string[];
}

// Bare tokens before the verb is resolved. `doctor`, `card create character` and `tui` have the
// same shape, so only the command table can say where the verb ends.
export interface RawArguments {
  readonly words: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

// Which flags take a value comes from the catalog, so `--help` and the parser can never disagree.
// Without the boolean list a boolean flag would swallow the token after it — `draft generate
// --json 01-a` would lose the scene and silently leave JSON mode off.
const booleanFlags = booleanFlagNames;
const valueFlags = valueFlagNames;

// The two short forms every CLI is expected to honour.
const shortFlags: Readonly<Record<string, string>> = { '-h': '--help', '-v': '--version' };

export interface ParseFailure {
  readonly message: string;
  // Set when the failure is a flag the catalog does not know, so the caller can suggest a near one.
  readonly unknownFlag?: string;
}

// `storyboard draft generate 01-a --provider claude --json` splits into a verb path, positionals and
// flags. Flags may appear anywhere, including before the verb. Deliberately hand-rolled: the
// surface is small and the command catalog already describes every flag it accepts.
export function parseArguments(argv: readonly string[]): RawArguments | ParseFailure {
  const words: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = shortFlags[argv[index] ?? ''] ?? argv[index] ?? '';

    if (!token.startsWith('--')) {
      words.push(token);
      continue;
    }

    const [name, inlineValue] = splitFlag(token.slice(2));

    if (!booleanFlags.has(name) && !valueFlags.has(name)) {
      return { message: `알 수 없는 옵션: --${name}`, unknownFlag: name };
    }

    if (booleanFlags.has(name)) {
      if (inlineValue !== undefined && inlineValue !== 'true' && inlineValue !== 'false') {
        return { message: `--${name} 은 값을 받지 않습니다.` };
      }
      flags[name] = inlineValue !== 'false';
      continue;
    }

    if (inlineValue !== undefined) {
      flags[name] = inlineValue;
      continue;
    }

    const next = argv[index + 1];

    if (next === undefined || next.startsWith('--')) {
      return { message: `--${name} 에 값이 필요합니다.` };
    }

    flags[name] = next;
    index += 1;
  }

  return { words, flags };
}

// Longest verb wins: `draft check grammar 01-a` resolves to the two-word verb and leaves the kind
// and the stem as positionals.
export function resolveVerb(raw: RawArguments, verbs: readonly string[]): ParsedArguments {
  for (let length = Math.min(3, raw.words.length); length > 0; length -= 1) {
    const candidate = raw.words.slice(0, length).join(' ');

    if (verbs.includes(candidate)) {
      return {
        path: raw.words.slice(0, length),
        flags: raw.flags,
        positionals: raw.words.slice(length),
      };
    }
  }

  return {
    path: raw.words.slice(0, Math.min(2, raw.words.length)),
    flags: raw.flags,
    positionals: [],
  };
}

export function isParseFailure(parsed: RawArguments | ParseFailure): parsed is ParseFailure {
  return 'message' in parsed;
}

function splitFlag(token: string): [string, string | undefined] {
  const separator = token.indexOf('=');
  return separator === -1
    ? [token, undefined]
    : [token.slice(0, separator), token.slice(separator + 1)];
}

export function flagString(
  flags: Readonly<Record<string, string | boolean>>,
  name: string,
): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function flagBoolean(
  flags: Readonly<Record<string, string | boolean>>,
  name: string,
): boolean {
  return flags[name] === true || flags[name] === 'true';
}
