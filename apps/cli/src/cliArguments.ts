import { booleanFlagNames, valueFlagNames } from './commands/catalog';

export interface ParsedArguments {
  readonly path: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly positionals: readonly string[];
}

export interface RawArguments {
  readonly words: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

const booleanFlags: ReadonlySet<string> = booleanFlagNames;
const valueFlags: ReadonlySet<string> = valueFlagNames;

const shortFlags: Readonly<Record<string, string>> = { '-h': '--help', '-v': '--version' };

export interface ParseFailure {
  readonly message: string;
  readonly unknownFlag?: string;
}

export function parseArguments(argv: readonly string[]): RawArguments | ParseFailure {
  const words: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index: number = 0; index < argv.length; index += 1) {
    const token: string = shortFlags[argv[index] ?? ''] ?? argv[index] ?? '';

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

    const next: string | undefined = argv[index + 1];

    if (next === undefined || next.startsWith('--')) {
      return { message: `--${name} 에 값이 필요합니다.` };
    }

    flags[name] = next;
    index += 1;
  }

  return { words, flags };
}

const longestVerbWordCount: number = 3;
const nounVerbWordCount: number = 2;

export function resolveVerb(raw: RawArguments, verbs: readonly string[]): ParsedArguments {
  for (
    let length: number = Math.min(longestVerbWordCount, raw.words.length);
    length > 0;
    length -= 1
  ) {
    const candidate: string = raw.words.slice(0, length).join(' ');

    if (verbs.includes(candidate)) {
      return {
        path: raw.words.slice(0, length),
        flags: raw.flags,
        positionals: raw.words.slice(length),
      };
    }
  }

  return {
    path: raw.words.slice(0, nounVerbWordCount),
    flags: raw.flags,
    positionals: raw.words.slice(nounVerbWordCount),
  };
}

export function isParseFailure(parsed: RawArguments | ParseFailure): parsed is ParseFailure {
  return 'message' in parsed;
}

function splitFlag(token: string): [string, string | undefined] {
  const separator: number = token.indexOf('=');
  return separator === -1
    ? [token, undefined]
    : [token.slice(0, separator), token.slice(separator + 1)];
}

export function flagString(
  flags: Readonly<Record<string, string | boolean>>,
  name: string,
): string | undefined {
  const value: string | boolean | undefined = flags[name];
  return typeof value === 'string' ? value : undefined;
}

export function flagBoolean(
  flags: Readonly<Record<string, string | boolean>>,
  name: string,
): boolean {
  return flags[name] === true || flags[name] === 'true';
}
