import type { SituationWithCharacters } from '@storyboard/story-ai';

import { pipelineDefaults } from './pipelineDefaults';

export function dedupeSituations(
  items: readonly SituationWithCharacters[],
): SituationWithCharacters[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = (item.situation || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
  const blocks = sourceBody
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  if (blocks.length < 2) {
    return [...items];
  }

  const limit = Math.max(1, blocks.length);
  const merged = [...items];

  while (merged.length > limit) {
    let mergeIndex = 0;
    let smallestLength = Number.POSITIVE_INFINITY;

    for (let index = 0; index < merged.length - 1; index += 1) {
      const first = merged[index];
      const second = merged[index + 1];
      if (!first || !second) {
        continue;
      }

      const length = first.situation.length + second.situation.length;
      if (length < smallestLength) {
        smallestLength = length;
        mergeIndex = index;
      }
    }

    const first = merged[mergeIndex];
    const second = merged[mergeIndex + 1];
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
  let currentChars = 0;

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

const MAX_SCENE_BREAK_NEWLINE_COUNT = pipelineDefaults.context.maxSceneBreakNewlines;

export function resolveSceneBreakJoiner(rawSeparator: string | undefined): string | undefined {
  const separator = rawSeparator?.trim();

  if (!separator) {
    return undefined;
  }

  if (/^\d+$/.test(separator)) {
    const newlineCount = Math.min(Number.parseInt(separator, 10), MAX_SCENE_BREAK_NEWLINE_COUNT);
    return newlineCount > 0 ? '\n'.repeat(newlineCount) : undefined;
  }

  return `\n\n${separator}\n\n`;
}

// NOTE: 청크 포맷 호출이 소설 본문 대신 "분량 한계라 연재형/압축형 중 고르라"는 메타 안내를 돌려보내는
// 경우가 있어, 그게 원고에 박히지 않도록 감지한다. 길이 핑계와 선택지 제시가 함께 있을 때만 메타로 본다.
export function looksLikeFormatMetaLeak(text: string): boolean {
  const hasLengthExcuse =
    /분량[^\n]{0,8}(한계|제한|많|길)|한 ?번에 (다|모두|전부)|토큰 ?(한계|제한|수)/.test(text);
  const offersOptions =
    /연재형|압축형|다음 중|어느 (쪽|것|걸)|선택해|골라|옵션|원하시(는|면)|알려 ?주(세요|시면)/.test(
      text,
    );
  return hasLengthExcuse && offersOptions;
}

const MAX_CONDENSED_CONTEXT_CHARS = pipelineDefaults.context.condensedMaxChars;

// NOTE: 앞서 이 압축은 콜론이 있는 줄(= '캐릭터명: 대사')만 남겨 지문을 통째로 버렸다. 그래서 뒤
// 비트가 "인물이 이미 그 자리에 들어와 있다"는 사실을 알 수 없어 매번 무대를 다시 세우고 같은
// 질문을 되풀이했다. 맥락은 대사만이 아니므로 지문도 남기고, 빈 줄만 걷어낸 뒤 예산으로 자른다.
export function condensePreviousContext(
  previousContext: string | undefined,
  enabled: boolean,
): string | undefined {
  if (!previousContext) {
    return undefined;
  }

  if (!enabled) {
    return previousContext;
  }

  if (previousContext.length <= MAX_CONDENSED_CONTEXT_CHARS) {
    return previousContext;
  }

  const condensed = previousContext
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return condensed.length <= MAX_CONDENSED_CONTEXT_CHARS
    ? condensed
    : condensed.slice(-MAX_CONDENSED_CONTEXT_CHARS);
}
