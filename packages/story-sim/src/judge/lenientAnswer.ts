function foldQuotes(text: string): string {
  return text.replace(/[“”]/g, '"');
}

function unescapeJsonString(text: string): string {
  return text.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
}

function stringField(text: string, key: string, nextKey: string | undefined): string | undefined {
  const start: RegExpExecArray | null = new RegExp(`"${key}"\\s*:\\s*"`, 'u').exec(text);

  if (start === null) {
    return undefined;
  }

  const from: number = start.index + start[0].length;
  const terminator: RegExp =
    nextKey === undefined
      ? /"\s*\}\s*(```)?\s*$/u
      : new RegExp(`"\\s*,\\s*"${nextKey}"\\s*:`, 'u');
  const rest: string = text.slice(from);
  const end: RegExpExecArray | null = terminator.exec(rest);

  if (end !== null) {
    return unescapeJsonString(rest.slice(0, end.index));
  }

  if (nextKey === undefined) {
    const tail: string = unescapeJsonString(rest.replace(/```\s*$/u, '').trim());
    return tail.length === 0 ? undefined : tail;
  }

  return undefined;
}

export interface LenientTurn {
  readonly engagement: number;
  readonly continueReading: boolean;
  readonly reason: string;
  readonly quote: string;
}

export function readTurnLeniently(raw: string): LenientTurn | null {
  const text: string = foldQuotes(raw);
  const engagement: RegExpExecArray | null = /"engagement"\s*:\s*(-?\d+(?:\.\d+)?)/u.exec(text);
  const continueReading: RegExpExecArray | null = /"continueReading"\s*:\s*(true|false)/u.exec(text);
  const reason: string | undefined = stringField(text, 'reason', 'quote');
  const quote: string | undefined = stringField(text, 'quote', undefined);

  if (engagement === null || continueReading === null || reason === undefined || quote === undefined) {
    return null;
  }

  return {
    engagement: Number(engagement[1]),
    continueReading: continueReading[1] === 'true',
    reason,
    quote,
  };
}

export function readCritiqueLeniently(
  raw: string,
): { readonly score: number; readonly reason: string; readonly quote?: string } | null {
  const text: string = foldQuotes(raw);
  const score: RegExpExecArray | null = /"score"\s*:\s*(\d+(?:\.\d+)?)/u.exec(text);
  const hasQuote: boolean = /"quote"\s*:/u.test(text);
  const reason: string | undefined = stringField(text, 'reason', hasQuote ? 'quote' : undefined);
  const quote: string | undefined = hasQuote ? stringField(text, 'quote', undefined) : undefined;

  if (score === null || reason === undefined) {
    return null;
  }

  return { score: Number(score[1]), reason, ...(quote === undefined ? {} : { quote }) };
}

export function readQuoteLeniently(raw: string): { readonly quote: string } | null {
  const quote: string | undefined = stringField(foldQuotes(raw), 'quote', undefined);
  return quote === undefined ? null : { quote };
}

export function readRankingLeniently(raw: string): { readonly ranking: readonly string[] } | null {
  const text: string = foldQuotes(raw);
  const match: RegExpExecArray | null = /"ranking"\s*:\s*\[([^\]]*)\]/u.exec(text);

  if (match === null) {
    return null;
  }

  const ranking: string[] = [...(match[1] as string).matchAll(/"([^"]*)"/gu)].map((entry) => entry[1] as string);
  return ranking.length === 0 ? null : { ranking };
}
