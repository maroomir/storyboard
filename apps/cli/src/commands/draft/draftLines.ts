import { flagString, type ParsedArguments } from '@/cliArguments';

export interface LineRange {
  readonly from: number;
  readonly to: number;
}

export function parseLineRange(raw: string | undefined): LineRange | undefined | 'invalid' {
  if (raw === undefined) {
    return undefined;
  }

  const match: RegExpExecArray | null = /^(\d+)-(\d+)$/.exec(raw.trim());

  if (!match) {
    return 'invalid';
  }

  const from: number = Number(match[1]);
  const to: number = Number(match[2]);
  return from >= 1 && to >= from ? { from, to } : 'invalid';
}

export function sliceLines(body: string, range: LineRange | undefined): string {
  if (range === undefined) {
    return body;
  }

  return body
    .split('\n')
    .slice(range.from - 1, range.to)
    .join('\n');
}

export function replaceLines(
  body: string,
  range: LineRange | undefined,
  replacement: string,
): string {
  if (range === undefined) {
    return replacement;
  }

  const lines: string[] = body.split('\n');
  return [
    ...lines.slice(0, range.from - 1),
    ...replacement.split('\n'),
    ...lines.slice(range.to),
  ].join('\n');
}

export function rangeFrom(args: ParsedArguments): LineRange | undefined | 'invalid' {
  return parseLineRange(flagString(args.flags, 'lines'));
}
