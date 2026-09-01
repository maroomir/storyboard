export interface ParsedArguments {
  readonly path: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly positionals: readonly string[];
}

// Flags that never take a value. Without this list a boolean flag swallows the token after it —
// `scene generate --json 01-a` would lose the scene and silently leave JSON mode off.
const booleanFlags = new Set([
  'all',
  'force',
  'help',
  'json',
  'no-revise',
  'resume',
  'verbose',
  'version',
]);

const valueFlags = new Set(['workspace', 'provider', 'model', 'revise-iterations']);

export interface ParseFailure {
  readonly message: string;
}

// `storyboard scene generate 01-a --provider codex --json` splits into a verb path, positionals and
// flags. Flags may appear anywhere, including before the verb. Deliberately hand-rolled: the
// surface is small, and a parser dependency would be the CLI's only one.
export function parseArguments(argv: readonly string[]): ParsedArguments | ParseFailure {
  const path: string[] = [];
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';

    if (!token.startsWith('--')) {
      // The verb is the first two bare words; anything after them is a target.
      (path.length < 2 && !token.includes('/') && !token.includes('.') ? path : positionals).push(
        token,
      );
      continue;
    }

    const [name, inlineValue] = splitFlag(token.slice(2));

    if (!booleanFlags.has(name) && !valueFlags.has(name)) {
      return { message: `알 수 없는 옵션: --${name}` };
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

  return { path, flags, positionals };
}

export function isParseFailure(parsed: ParsedArguments | ParseFailure): parsed is ParseFailure {
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
