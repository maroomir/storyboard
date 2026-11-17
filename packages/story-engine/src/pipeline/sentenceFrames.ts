export interface SentenceFrameCount {
  readonly frame: string;
  readonly count: number;
}

export interface SentenceFrameBudget {
  readonly frames: readonly string[];
  readonly limit: number;
}

export interface SectionSentenceFrameBudgetInput {
  readonly frames: readonly string[];
  readonly framesPer10kChars: number;
  readonly sectionTargetLengths: readonly number[];
}

const charsPerFrameRate: number = 10_000;
const smallestSectionFrameLimit: number = 1;
const quotedDialoguePattern: RegExp = /[“"][^”"\n]*[”"]/g;

function stripQuotedDialogue(text: string): string {
  return text.replace(quotedDialoguePattern, ' ');
}

function countOccurrences(text: string, frame: string): number {
  return text.split(frame).length - 1;
}

export function countNarrationSentenceFrames(
  text: string,
  frames: readonly string[],
): SentenceFrameCount[] {
  const narration: string = stripQuotedDialogue(text);

  return frames
    .map((frame) => ({ frame, count: countOccurrences(narration, frame) }))
    .filter((entry) => entry.count > 0);
}

export function planSectionSentenceFrameBudgets(
  input: SectionSentenceFrameBudgetInput,
): (SentenceFrameBudget | undefined)[] {
  const frames: string[] = input.frames.filter((frame) => frame.trim().length > 0);
  const totalTargetLength: number = input.sectionTargetLengths.reduce(
    (sum, length) => sum + length,
    0,
  );
  if (frames.length === 0 || totalTargetLength <= 0) {
    return input.sectionTargetLengths.map((): undefined => undefined);
  }

  return input.sectionTargetLengths.map(
    (targetLength): SentenceFrameBudget => ({
      frames,
      limit: Math.max(
        smallestSectionFrameLimit,
        Math.floor((targetLength * input.framesPer10kChars) / charsPerFrameRate),
      ),
    }),
  );
}

export function describeSentenceFrameBudget(budget: SentenceFrameBudget): string {
  const frames: string = budget.frames.map((frame) => `«${frame}»`).join('·');
  return `서술에서 ${frames} 같은 틀은 각각 ${budget.limit}번까지`;
}

export function findOverusedSentenceFrames(input: {
  readonly expanded: string;
  readonly section: string;
  readonly budget: SentenceFrameBudget;
}): SentenceFrameCount[] {
  const allowedByFrame: Map<string, number> = new Map(
    countNarrationSentenceFrames(input.section, input.budget.frames).map((entry) => [
      entry.frame,
      entry.count,
    ]),
  );

  return countNarrationSentenceFrames(input.expanded, input.budget.frames).filter(
    (entry) => entry.count > Math.max(input.budget.limit, allowedByFrame.get(entry.frame) ?? 0),
  );
}
