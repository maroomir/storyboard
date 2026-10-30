import type { SituationWithCharacters } from '@storyboard/story-ai';

import { pipelineDefaults } from '#engine/pipeline/pipelineDefaults';

export function dedupeSituations(
  items: readonly SituationWithCharacters[],
): SituationWithCharacters[] {
  const seen: Set<string> = new Set<string>();
  return items.filter((item) => {
    const key: string = (item.situation || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key) {
      return false;
    }
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function mergeSituationsToSourceBlockLimit(
  items: readonly SituationWithCharacters[],
  sourceBody: string,
): SituationWithCharacters[] {
  const blocks: string[] = sourceBody
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  if (blocks.length < 2) {
    return [...items];
  }

  const limit: number = Math.max(1, blocks.length);
  const merged: SituationWithCharacters[] = [...items];

  while (merged.length > limit) {
    let mergeIndex: number = 0;
    let smallestLength: number = Number.POSITIVE_INFINITY;

    for (let index: number = 0; index < merged.length - 1; index += 1) {
      const first: SituationWithCharacters | undefined = merged[index];
      const second: SituationWithCharacters | undefined = merged[index + 1];
      if (!first || !second) {
        continue;
      }

      const length: number = first.situation.length + second.situation.length;
      if (length < smallestLength) {
        smallestLength = length;
        mergeIndex = index;
      }
    }

    const first: SituationWithCharacters | undefined = merged[mergeIndex];
    const second: SituationWithCharacters | undefined = merged[mergeIndex + 1];
    if (!first || !second) {
      break;
    }

    merged.splice(mergeIndex, 2, {
      situation: `${first.situation}\n${second.situation}`,
      characters: [...new Set([...first.characters, ...second.characters])],
    });
  }

  return merged;
}

export function chunkDialoguePiecesByBudget(
  pieces: readonly string[],
  maxChars: number,
): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentChars: number = 0;

  for (const piece of pieces) {
    if (current.length > 0 && currentChars + piece.length > maxChars) {
      chunks.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(piece);
    currentChars += piece.length;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

const MAX_SCENE_BREAK_NEWLINE_COUNT: number = pipelineDefaults.context.maxSceneBreakNewlines;

export function resolveSceneBreakJoiner(rawSeparator: string | undefined): string | undefined {
  const separator: string | undefined = rawSeparator?.trim();

  if (!separator) {
    return undefined;
  }

  if (/^\d+$/.test(separator)) {
    const newlineCount: number = Math.min(Number.parseInt(separator, 10), MAX_SCENE_BREAK_NEWLINE_COUNT);
    return newlineCount > 0 ? '\n'.repeat(newlineCount) : undefined;
  }

  return `\n\n${separator}\n\n`;
}

export function looksLikeFormatMetaLeak(text: string): boolean {
  const hasLengthExcuse: boolean =
    /분량[^\n]{0,8}(한계|제한|많|길)|한 ?번에 (다|모두|전부)|토큰 ?(한계|제한|수)/.test(text);
  const offersOptions: boolean =
    /연재형|압축형|다음 중|어느 (쪽|것|걸)|선택해|골라|옵션|원하시(는|면)|알려 ?주(세요|시면)/.test(
      text,
    );
  return hasLengthExcuse && offersOptions;
}


export function condensePreviousContext(
  previousContext: string | undefined,
  enabled: boolean,
  maxChars: number = pipelineDefaults.context.condensedMaxChars,
): string | undefined {
  if (!previousContext) {
    return undefined;
  }

  if (!enabled) {
    return previousContext;
  }

  if (previousContext.length <= maxChars) {
    return previousContext;
  }

  const condensed: string = previousContext
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return condensed.length <= maxChars
    ? condensed
    : condensed.slice(-maxChars);
}
