import type { SceneDialogueRewrite } from '@storyboard/story-ai';
import { quotedDialoguePatternFor } from './sceneSectionPlan';
import type { ResolvedSceneGenerationTuning } from './sceneGenerationTuning';

export interface NumberedSkeleton {
  // 따옴표 대사마다 바로 앞에 ⟨n⟩을 단 뼈대. 인물별 다듬기 호출이 받는 본문이다.
  readonly text: string;
  // n번째 대사가 원래 뼈대에서 차지한 자리(따옴표 포함)와 안쪽 문장.
  readonly dialogues: readonly {
    readonly start: number;
    readonly end: number;
    readonly text: string;
  }[];
}

// NOTE: 인물별 호출은 자기 대사를 번호로 가리켜 돌려준다. 번호는 뼈대의 따옴표 대사 순서이며
// 검증(countDialogueTurns)과 같은 패턴으로 세므로, 병합한 결과의 턴 수는 구조상 뼈대와 같다.
export function numberSkeletonDialogue(
  skeleton: string,
  tuning: ResolvedSceneGenerationTuning,
): NumberedSkeleton {
  const pattern = quotedDialoguePatternFor(tuning.dialogueMinimumQuotedLength);
  const dialogues: { start: number; end: number; text: string }[] = [];
  let text = '';
  let cursor = 0;

  for (const match of skeleton.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    dialogues.push({ start, end, text: (match[1] ?? '').trim() });
    text += `${skeleton.slice(cursor, start)}⟨${dialogues.length}⟩`;
    cursor = start;
  }

  return { text: text + skeleton.slice(cursor), dialogues };
}

export interface DialogueRewriteMerge {
  readonly text: string;
  readonly replacedCount: number;
  // 두 인물이 같은 번호를 자기 대사라고 한 경우. 뼈대가 우선이므로 그 줄은 그대로 둔다.
  readonly contestedIndices: readonly number[];
}

const forbiddenRewriteCharacters = /[“”"\n⟨⟩]/;

// 번호 하나를 한 인물만 가져갔고, 돌려준 문장이 따옴표·줄바꿈·번호 표시 없는 한 문장일 때만 바꿔 넣는다.
export function mergeDialogueRewrites(
  skeleton: string,
  numbered: NumberedSkeleton,
  rewritesByCharacter: ReadonlyMap<string, readonly SceneDialogueRewrite[]>,
): DialogueRewriteMerge {
  const claims = new Map<number, string[]>();

  for (const rewrites of rewritesByCharacter.values()) {
    for (const rewrite of rewrites) {
      const text = stripOuterQuotes(rewrite.text);
      const dialogue = numbered.dialogues[rewrite.index - 1];

      if (dialogue === undefined || text.length === 0 || forbiddenRewriteCharacters.test(text)) {
        continue;
      }

      claims.set(rewrite.index, [...(claims.get(rewrite.index) ?? []), text]);
    }
  }

  const contestedIndices = [...claims.entries()]
    .filter(([, texts]) => texts.length > 1)
    .map(([index]) => index)
    .sort((left, right) => left - right);
  let text = skeleton;
  let replacedCount = 0;

  for (let index = numbered.dialogues.length; index >= 1; index -= 1) {
    const texts = claims.get(index);
    const dialogue = numbered.dialogues[index - 1];

    if (texts === undefined || texts.length !== 1 || dialogue === undefined) {
      continue;
    }

    const replacement = texts[0] as string;
    if (replacement === dialogue.text) {
      continue;
    }

    text = `${text.slice(0, dialogue.start)}“${replacement}”${text.slice(dialogue.end)}`;
    replacedCount += 1;
  }

  return { text, replacedCount, contestedIndices };
}

// NOTE: 모델은 받은 뼈대의 ⟨n⟩ 번호를 문장 앞에 그대로 붙여 돌려주기도 한다. 그대로 넣으면 어느
// 검증도 잡지 못하고 원고까지 번호가 남는다.
const dialogueNumberMarker = /⟨\d+⟩/g;

function stripOuterQuotes(text: string): string {
  return text
    .replace(dialogueNumberMarker, '')
    .trim()
    .replace(/^[“"]/, '')
    .replace(/[”"]$/, '')
    .trim();
}
