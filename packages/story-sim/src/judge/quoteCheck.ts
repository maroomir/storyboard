const quoteFolding: readonly (readonly [RegExp, string])[] = [
  [/[“”„‟«»〝〞「」『』‘’‚‛‹›']/g, '"'],
];

function normalize(text: string): string {
  return quoteFolding.reduce(
    (folded, [pattern, replacement]) => folded.replace(pattern, replacement),
    text.replace(/\s/g, '').replace(/\*/g, ''),
  );
}

function unwrapped(needle: string): string {
  const match: RegExpExecArray | null = /^(")(.*)\1$/.exec(needle);
  return match === null ? needle : (match[2] as string);
}

const pieceBoundary: RegExp = /(?<=[.!?…"])\s*/u;
const minimumPieceLength: number = 4;

function piecesOf(quote: string): readonly string[] {
  return quote
    .split(pieceBoundary)
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

export function isQuoteGrounded(quote: string, draft: string): boolean {
  const needle: string = normalize(quote);
  const haystack: string = normalize(draft);
  const inner: string = unwrapped(needle);

  if (needle.length === 0) {
    return false;
  }

  if (haystack.includes(needle) || (inner.length > 0 && haystack.includes(inner))) {
    return true;
  }

  const pieces: string[] = piecesOf(quote)
    .map((piece) => unwrapped(normalize(piece)))
    .filter((piece) => piece.length >= minimumPieceLength);

  return pieces.length > 1 && pieces.every((piece) => haystack.includes(piece));
}
