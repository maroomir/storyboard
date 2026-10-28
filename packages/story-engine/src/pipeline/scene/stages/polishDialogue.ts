import {
  claimableRewriteText,
  mergeDialogueRewrites,
  numberSkeletonDialogue,
  type DialogueRewriteMerge,
  type NumberedSkeleton,
} from '#engine/pipeline/dialogueRewrites';
import { characterSpeechToOthers } from '#engine/pipeline/scene/characterVoices';
import type { SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import {
  assertNotCancelled,
  buildGenerateOptions,
  withAttribution,
} from '#engine/pipeline/sceneGenerationStages';
import type { DialoguePolishSummary } from '#engine/pipeline/sceneGenerationTypes';
import {
  findPolishedLineViolations,
  validatePolishedSkeleton,
  type SectionViolation,
} from '#engine/pipeline/sectionValidation';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import {
  characterCatchphrases,
  type GenerateTextOptions,
  type SceneDialoguePolishResult,
  type SceneDialogueRewrite,
} from '@storyboard/story-ai';
import type { CharacterCard } from '@storyboard/story-model';

export interface DialoguePolishOutcome {
  readonly text: string;
  readonly warnings: readonly string[];
  readonly summary: DialoguePolishSummary | undefined;
}

export interface PartialRewrites {
  rewrites: readonly SceneDialogueRewrite[];
  heldBack: number;
}

export function otherVoices(
  characters: readonly CharacterCard[],
  name: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    characters.flatMap((character) => {
      const voice: string | undefined = character.voice?.[0]?.trim();
      return character.name === name || voice === undefined || voice.length === 0
        ? []
        : [[character.name, voice]];
    }),
  );
}

export class PolishDialogueStage implements ISceneStage {
  public readonly id: SceneStageId = 'polishDialogue';

  public async run(run: SceneGenerationRun): Promise<void> {
    const polished: DialoguePolishOutcome = await this.polishDialogueOrKeepSkeleton(
      run,
      withAttribution(
        {
          ...buildGenerateOptions(run.providers, 'sceneDialoguePolish'),
          styleDirective: run.styleDirective,
        },
        { primary: run.sceneRef },
      ),
    );

    run.polishedText = polished.text;
    run.dialoguePolish = polished.summary;
    run.warnings.push(...polished.warnings);
    assertNotCancelled(run.shouldCancel);
  }

  private async polishDialogueOrKeepSkeleton(
    run: SceneGenerationRun,
    options: GenerateTextOptions,
  ): Promise<DialoguePolishOutcome> {
    const numbered: NumberedSkeleton = numberSkeletonDialogue(run.skeleton, run.tuning);
    const speakers: string[] = [...run.personasUsed.keys()];

    if (numbered.dialogues.length === 0 || speakers.length === 0) {
      run.onProgress?.('polishDialogue', 1, 1);
      return { text: run.skeleton, warnings: [], summary: undefined };
    }

    const catchphrases: ReadonlyMap<string, readonly string[]> = characterCatchphrases(
      run.context.characters,
    );
    const speechToOthers: ReadonlyMap<string, readonly string[]> = characterSpeechToOthers(
      run.context.characters,
    );
    const validateAgainstSkeleton = (polished: string): SectionViolation[] =>
      validatePolishedSkeleton({
        skeleton: run.skeleton,
        polished,
        characters: run.context.characters,
        lengthLimit: run.skeleton.length * run.tuning.polishLengthLimitRatio,
        tuning: run.tuning,
      });

    const accepted: Map<string, readonly SceneDialogueRewrite[]> = new Map<
      string,
      readonly SceneDialogueRewrite[]
    >();
    const rejected: Map<string, readonly SectionViolation[]> = new Map<
      string,
      readonly SectionViolation[]
    >();
    const partial: Map<string, PartialRewrites> = new Map<string, PartialRewrites>();
    const truncated: Set<string> = new Set<string>();
    let pending: string[] = speakers;

    for (
      let attempt: number = 0;
      attempt < run.tuning.polishRetryLimit && pending.length > 0;
      attempt += 1
    ) {
      const failing: string[] = [];

      for (const [position, name] of pending.entries()) {
        run.onProgress?.('polishDialogue', position + 1, pending.length);
        const retryReasons: string[] | undefined = rejected
          .get(name)
          ?.map((violation) => violation.detail);
        const response: SceneDialoguePolishResult = await run.aiService.polishSceneDialogue(
          {
            numberedSkeleton: numbered.text,
            character: {
              name,
              persona: run.personasUsed.get(name) ?? '',
              catchphrases: catchphrases.get(name) ?? [],
              samples: run.voiceSamples.get(name) ?? [],
              knowledge: run.input.characterKnowledge?.get(name) ?? [],
              speechToOthers: speechToOthers.get(name) ?? [],
              relationChanges: run.input.characterRelations?.get(name) ?? [],
            },
            otherCharacters: speakers.filter((other) => other !== name),
            otherVoices: otherVoices(run.context.characters, name),
            ...(retryReasons === undefined ? {} : { retryReasons }),
          },
          options,
        );

        if (response.isTruncated) {
          truncated.add(name);
        } else {
          truncated.delete(name);
        }

        const lines: Map<number, string> = new Map(
          response.rewrites.flatMap((rewrite) => {
            const text: string | undefined = claimableRewriteText(rewrite, numbered);
            return text === undefined ? [] : [[rewrite.index, text] as const];
          }),
        );
        const lineViolations: Map<number, SectionViolation[]> = findPolishedLineViolations({
          skeleton: run.skeleton,
          lines,
          characters: run.context.characters,
          tuning: run.tuning,
        });
        const kept: SceneDialogueRewrite[] = response.rewrites.filter(
          (rewrite) => !lineViolations.has(rewrite.index),
        );
        const solo: DialogueRewriteMerge = mergeDialogueRewrites(
          run.skeleton,
          numbered,
          new Map([[name, kept]]),
        );
        const sceneViolations: SectionViolation[] = validateAgainstSkeleton(solo.text);
        const violations: SectionViolation[] = [
          ...[...lineViolations.values()].flat(),
          ...sceneViolations,
        ];

        if (violations.length === 0) {
          accepted.set(name, response.rewrites);
          rejected.delete(name);
          partial.delete(name);
        } else {
          rejected.set(name, violations);
          failing.push(name);
          if (sceneViolations.length === 0) {
            partial.set(name, { rewrites: kept, heldBack: lineViolations.size });
          } else {
            partial.delete(name);
          }
        }
      }

      pending = failing;
    }

    for (const [name, kept] of partial) {
      accepted.set(name, kept.rewrites);
    }

    const warnings: string[] = [
      ...[...rejected.entries()].map(([name, violations]) => {
        const details: string = violations.map((violation) => violation.detail).join(' / ');
        const kept: PartialRewrites | undefined = partial.get(name);
        return kept === undefined
          ? `${name}의 대사 다듬기를 되돌렸습니다 — ${details}`
          : `${name}의 대사 ${kept.heldBack}개를 뼈대대로 두었습니다 — ${details}`;
      }),
      ...[...truncated]
        .filter((name) => !rejected.has(name))
        .map(
          (name) => `${name}의 대사 다듬기 응답이 출력 한도에서 잘려 일부 대사를 손보지 못했습니다`,
        ),
    ];

    const merged: DialogueRewriteMerge = mergeDialogueRewrites(run.skeleton, numbered, accepted);
    const combinedViolations: SectionViolation[] = validateAgainstSkeleton(merged.text);

    if (combinedViolations.length > 0) {
      return {
        text: run.skeleton,
        warnings: [
          ...warnings,
          ...combinedViolations.map(
            (violation) => `대사 다듬기를 되돌렸습니다 — ${violation.detail}`,
          ),
        ],
        summary: { lineCount: numbered.dialogues.length, polishedCount: 0, contestedCount: 0 },
      };
    }

    return {
      text: merged.text,
      warnings: [
        ...warnings,
        ...(merged.contestedIndices.length === 0
          ? []
          : [
              `대사 ${merged.contestedIndices.join(', ')}번은 두 인물이 자기 대사라고 해 뼈대 그대로 두었습니다`,
            ]),
      ],
      summary: {
        lineCount: numbered.dialogues.length,
        polishedCount: merged.replacedCount,
        contestedCount: merged.contestedIndices.length,
      },
    };
  }
}
