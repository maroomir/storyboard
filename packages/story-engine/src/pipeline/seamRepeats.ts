export interface SeamRepeatOptions {
  readonly windowChars: number;
  readonly minimumRunWords: number;
  readonly ignoredPhrases: readonly string[];
}

const markerLinePattern: RegExp = /^\s*(?:---|⟪.*⟫)\s*$/;
const quotedDialoguePattern: RegExp = /[“"][^”"\n]*[”"]/g;
const wordSeparatorPattern: RegExp = /[^가-힣A-Za-z0-9]+/;
const ignoredWordMark: string = '|';

function extractNarration(text: string): string {
  return text
    .split('\n')
    .filter((line) => !markerLinePattern.test(line))
    .join(' ')
    .replace(quotedDialoguePattern, ' ');
}

function splitWords(narration: string, ignoredPhrases: readonly string[]): string[] {
  const masked: string = ignoredPhrases
    .filter((phrase) => phrase.trim().length > 0)
    .reduce((current, phrase) => current.split(phrase).join(` ${ignoredWordMark} `), narration);

  return masked
    .split(/\s+/)
    .map((word) => (word === ignoredWordMark ? word : word.split(wordSeparatorPattern).join('')))
    .filter((word) => word.length > 0);
}

function findLongestCommonWordRun(left: readonly string[], right: readonly string[]): string[] {
  let previousRow: number[] = new Array<number>(right.length + 1).fill(0);
  let longestLength: number = 0;
  let longestEnd: number = 0;

  for (let i: number = 1; i <= left.length; i += 1) {
    const currentRow: number[] = new Array<number>(right.length + 1).fill(0);

    for (let j: number = 1; j <= right.length; j += 1) {
      const isSameWord: boolean = left[i - 1] === right[j - 1] && left[i - 1] !== ignoredWordMark;
      if (!isSameWord) {
        continue;
      }

      currentRow[j] = (previousRow[j - 1] as number) + 1;
      if ((currentRow[j] as number) > longestLength) {
        longestLength = currentRow[j] as number;
        longestEnd = i;
      }
    }

    previousRow = currentRow;
  }

  return left.slice(longestEnd - longestLength, longestEnd);
}

export function findSeamRepeat(
  previousText: string,
  nextText: string,
  options: SeamRepeatOptions,
): string | undefined {
  const tail: string[] = splitWords(
    extractNarration(previousText).slice(-options.windowChars),
    options.ignoredPhrases,
  ).slice(1);
  const head: string[] = splitWords(
    extractNarration(nextText).slice(0, options.windowChars),
    options.ignoredPhrases,
  ).slice(0, -1);
  const run: string[] = findLongestCommonWordRun(tail, head);

  return run.length >= options.minimumRunWords ? run.join(' ') : undefined;
}
