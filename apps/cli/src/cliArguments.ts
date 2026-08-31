export interface ParsedArguments {
  readonly path: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly positionals: readonly string[];
}

// `storyboard scene generate 01-a --provider codex --json` splits into a verb path, positionals and
// flags. Deliberately hand-rolled: the surface is small, and a dependency here would be the only
// one the CLI has.
export function parseArguments(argv: readonly string[]): ParsedArguments {
  const path: string[] = [];
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let seenFlag = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? '';

    if (token.startsWith('--')) {
      seenFlag = true;
      const [name, inlineValue] = splitFlag(token.slice(2));
      const next = argv[index + 1];

      if (inlineValue !== undefined) {
        flags[name] = inlineValue;
      } else if (next !== undefined && !next.startsWith('-')) {
        flags[name] = next;
        index += 1;
      } else {
        flags[name] = true;
      }
      continue;
    }

    if (seenFlag || path.length >= 2 || token.includes('.') || token.includes('/')) {
      positionals.push(token);
      continue;
    }

    path.push(token);
  }

  return { path, flags, positionals };
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
