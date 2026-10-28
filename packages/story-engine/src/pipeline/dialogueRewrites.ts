import type { SceneDialogueRewrite } from '@storyboard/story-ai';
import { quotedDialoguePatternFor } from './sectionValidation';
import type { ResolvedSceneGenerationTuning } from './sceneGenerationTuning';

export interface NumberedDialogue {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface NumberedSkeleton {
  readonly text: string;
  readonly dialogues: readonly NumberedDialogue[];
}

export function numberSkeletonDialogue(
  skeleton: string,
  tuning: ResolvedSceneGenerationTuning,
): NumberedSkeleton {
  const pattern: RegExp = quotedDialoguePatternFor(tuning.dialogueMinimumQuotedLength);
  const dialogues: NumberedDialogue[] = [];
  let text: string = '';
  let cursor: number = 0;

  for (const match of skeleton.matchAll(pattern)) {
    const start: number = match.index ?? 0;
    const end: number = start + match[0].length;
    dialogues.push({ start, end, text: (match[1] ?? '').trim() });
    text += `${skeleton.slice(cursor, start)}⟨${dialogues.length}⟩`;
    cursor = start;
  }

  return { text: text + skeleton.slice(cursor), dialogues };
}

export interface DialogueRewriteMerge {
  readonly text: string;
  readonly replacedCount: number;
  readonly contestedIndices: readonly number[];
}

const forbiddenRewriteCharacters: RegExp = /[“”"\n⟨⟩]/;

export function mergeDialogueRewrites(
  skeleton: string,
  numbered: NumberedSkeleton,
  rewritesByCharacter: ReadonlyMap<string, readonly SceneDialogueRewrite[]>,
): DialogueRewriteMerge {
  const claims: Map<number, string[]> = new Map<number, string[]>();

  for (const rewrites of rewritesByCharacter.values()) {
    for (const rewrite of rewrites) {
      const text: string | undefined = claimableRewriteText(rewrite, numbered);

      if (text !== undefined) {
        claims.set(rewrite.index, [...(claims.get(rewrite.index) ?? []), text]);
      }
    }
  }

  const contestedIndices: number[] = [...claims.entries()]
    .filter(([, texts]) => texts.length > 1)
    .map(([index]) => index)
    .sort((left, right) => left - right);
  let text: string = skeleton;
  let replacedCount: number = 0;

  for (let index: number = numbered.dialogues.length; index >= 1; index -= 1) {
    const texts: string[] | undefined = claims.get(index);
    const dialogue: NumberedDialogue | undefined = numbered.dialogues[index - 1];

    if (texts === undefined || texts.length !== 1 || dialogue === undefined) {
      continue;
    }

    const replacement: string = texts[0] as string;
    if (replacement === dialogue.text) {
      continue;
    }

    text = `${text.slice(0, dialogue.start)}“${replacement}”${text.slice(dialogue.end)}`;
    replacedCount += 1;
  }

  return { text, replacedCount, contestedIndices };
}

export function claimableRewriteText(
  rewrite: SceneDialogueRewrite,
  numbered: NumberedSkeleton,
): string | undefined {
  const text: string = stripOuterQuotes(rewrite.text);

  if (
    numbered.dialogues[rewrite.index - 1] === undefined ||
    text.length === 0 ||
    forbiddenRewriteCharacters.test(text)
  ) {
    return undefined;
  }

  return text;
}

const dialogueNumberMarker: RegExp = /⟨\d+⟩/g;

function stripOuterQuotes(text: string): string {
  return text
    .replace(dialogueNumberMarker, '')
    .trim()
    .replace(/^[“"]/, '')
    .replace(/[”"]$/, '')
    .trim();
}
