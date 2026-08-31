import { z } from 'zod';

import { parseJsonArray } from './aiResponseParser';

export const unknownDialogueSpeaker = 'unknown';

export interface DialogueAttribution {
  readonly index: number;
  readonly speaker: string;
}

const dialogueAttributionSchema = z.object({
  index: z.number().int().min(1),
  speaker: z.string().trim().min(1),
});

// NOTE: 귀속은 말투 코퍼스를 쌓기 위한 메타데이터라서 본문 생성을 막지 않는다. 파싱이 실패하거나
// 명단에 없는 화자가 오면 그 자리를 unknown으로 두고 넘어간다.
export function coerceDialogueAttribution(
  rawText: string,
  turnCount: number,
  knownSpeakerIds: readonly string[],
): DialogueAttribution[] {
  const parsedArray = parseJsonArray(rawText) ?? [];
  const known = new Set(knownSpeakerIds);
  const speakerByIndex = new Map<number, string>();

  for (const item of parsedArray) {
    const parsed = dialogueAttributionSchema.safeParse(item);
    if (!parsed.success || parsed.data.index > turnCount) {
      continue;
    }

    if (speakerByIndex.has(parsed.data.index)) {
      continue;
    }

    const speaker = known.has(parsed.data.speaker) ? parsed.data.speaker : unknownDialogueSpeaker;
    speakerByIndex.set(parsed.data.index, speaker);
  }

  return Array.from({ length: turnCount }, (_, offset) => ({
    index: offset + 1,
    speaker: speakerByIndex.get(offset + 1) ?? unknownDialogueSpeaker,
  }));
}
