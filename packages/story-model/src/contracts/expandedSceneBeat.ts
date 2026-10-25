import { z } from 'zod';

import { parseJsonArray } from './aiResponseParser';

// 비트 전개 응답의 한 비트. 좌표의 출연은 모델이 부른 이름 그대로이며, 카드 id로 옮기는 것은 엔진이다.
export interface ExpandedSceneBeat {
  readonly text: string;
  readonly cast: readonly string[];
  readonly place?: string;
  readonly time?: string;
}

interface Proposal {
  text: string;
  cast?: unknown[];
  place?: string;
  time?: string;
}

const proposalSchema: z.ZodType<Proposal> = z.object({
  text: z.string(),
  cast: z.array(z.unknown()).optional(),
  place: z.string().optional(),
  time: z.string().optional(),
});

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed: string | undefined = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

// 문자열 배열(옛 응답)과 객체 배열을 모두 읽는다. 문자열은 좌표 없는 비트다.
export function coerceExpandedSceneBeats(rawText: string): ExpandedSceneBeat[] {
  return (parseJsonArray(rawText) ?? []).flatMap((item): ExpandedSceneBeat[] => {
    if (typeof item === 'string') {
      const text: string = item.trim();
      return text.length > 0 ? [{ text, cast: [] }] : [];
    }

    const parsed = proposalSchema.safeParse(item);
    const text: string = parsed.success ? parsed.data.text.trim() : '';
    if (!parsed.success || text.length === 0) {
      return [];
    }

    const cast: string[] = (parsed.data.cast ?? [])
      .filter((name): name is string => typeof name === 'string')
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
    const place: string | undefined = nonEmpty(parsed.data.place);
    const time: string | undefined = nonEmpty(parsed.data.time);

    return [
      {
        text,
        cast,
        ...(place === undefined ? {} : { place }),
        ...(time === undefined ? {} : { time }),
      },
    ];
  });
}
