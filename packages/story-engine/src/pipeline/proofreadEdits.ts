import { findBrokenGlyphSpans, type ProofreadEdit } from '@storyboard/story-model';

export interface ProofreadLimits {
  readonly maxEditLength: number;
  readonly maxEditDistance: number;
}

export interface ProofreadResult {
  readonly text: string;
  readonly appliedEdits: readonly ProofreadEdit[];
}

export function applyProofreadEdits(
  text: string,
  edits: readonly ProofreadEdit[],
  options: { readonly allowedText: string; readonly limits: ProofreadLimits },
): ProofreadResult {
  const limits: ProofreadLimits = options.limits;
  const appliedEdits: ProofreadEdit[] = [];
  let corrected: string = text;

  for (const edit of edits) {
    if (!isAcceptableEdit(corrected, edit, options.allowedText, limits)) {
      continue;
    }

    corrected = corrected.split(edit.before).join(edit.after);
    appliedEdits.push(edit);
  }

  return { text: corrected, appliedEdits };
}

function isAcceptableEdit(
  text: string,
  edit: ProofreadEdit,
  allowedText: string,
  limits: ProofreadLimits,
): boolean {
  const isChange: boolean = edit.before !== edit.after;
  const isInText: boolean = text.includes(edit.before);
  const isShortSpan: boolean = edit.before.length <= limits.maxEditLength;
  const keepsLineBreaks: boolean = !edit.before.includes('\n') && !edit.after.includes('\n');
  const isSmallChange: boolean =
    countEditDistance(edit.before, edit.after) <= limits.maxEditDistance;
  const isCleanResult: boolean = findBrokenGlyphSpans(edit.after, allowedText).length === 0;

  return isChange && isInText && isShortSpan && keepsLineBreaks && isSmallChange && isCleanResult;
}

function countEditDistance(left: string, right: string): number {
  let previous: number[] = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i: number = 1; i <= left.length; i += 1) {
    const current: number[] = [i];

    for (let j: number = 1; j <= right.length; j += 1) {
      const substitution: number =
        (previous[j - 1] as number) + (left[i - 1] === right[j - 1] ? 0 : 1);
      current[j] = Math.min(
        (previous[j] as number) + 1,
        (current[j - 1] as number) + 1,
        substitution,
      );
    }

    previous = current;
  }

  return previous[right.length] as number;
}

const paragraphBreak: string = '\n\n';

export function splitIntoProofreadChunks(text: string, chunkLength: number): string[] {
  const chunks: string[] = [];
  let chunkStart: number = 0;

  while (text.length - chunkStart > chunkLength) {
    const breakAt: number = text.lastIndexOf(paragraphBreak, chunkStart + chunkLength);
    const hasParagraphBreak: boolean = breakAt > chunkStart;
    const chunkEnd: number = hasParagraphBreak
      ? breakAt + paragraphBreak.length
      : findNextParagraphEnd(text, chunkStart + chunkLength);

    chunks.push(text.slice(chunkStart, chunkEnd));
    chunkStart = chunkEnd;
  }

  if (chunkStart < text.length) {
    chunks.push(text.slice(chunkStart));
  }

  return chunks;
}

function findNextParagraphEnd(text: string, from: number): number {
  const nextBreak: number = text.indexOf(paragraphBreak, from);
  return nextBreak < 0 ? text.length : nextBreak + paragraphBreak.length;
}
