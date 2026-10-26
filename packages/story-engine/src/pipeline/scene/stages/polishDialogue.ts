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
import type { ResolvedSceneGenerationTuning } from '#engine/pipeline/sceneGenerationTuning';
import type {
  DialoguePolishSummary,
  RunSceneGenerationPipelineInput,
  SceneGenerationPipelineAiService,
} from '#engine/pipeline/sceneGenerationTypes';
import {
  findPolishedLineViolations,
  validatePolishedSkeleton,
  type SectionViolation,
} from '#engine/pipeline/sceneSectionPlan';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import {
  characterCatchphrases,
  type GenerateTextOptions,
  type SceneDialoguePolishResult,
  type SceneDialogueRewrite,
} from '@storyboard/story-ai';
import type { CharacterCard, SceneContext } from '@storyboard/story-model';

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

export async function polishDialogueOrKeepSkeleton(input: {
  readonly aiService: Pick<SceneGenerationPipelineAiService, 'polishSceneDialogue'>;
  readonly skeleton: string;
  readonly personas: ReadonlyMap<string, string>;
  readonly voiceSamples: ReadonlyMap<string, readonly string[]>;
  readonly characterKnowledge: ReadonlyMap<string, readonly string[]> | undefined;
  readonly characterRelations: ReadonlyMap<string, readonly string[]> | undefined;
  readonly characters: SceneContext['characters'];
  readonly options: GenerateTextOptions;
  readonly tuning: ResolvedSceneGenerationTuning;
  readonly onProgress: RunSceneGenerationPipelineInput['onProgress'];
}): Promise<DialoguePolishOutcome> {
  const numbered: NumberedSkeleton = numberSkeletonDialogue(input.skeleton, input.tuning);
  const speakers: string[] = [...input.personas.keys()];

  if (numbered.dialogues.length === 0 || speakers.length === 0) {
    input.onProgress?.('polishDialogue', 1, 1);
    return { text: input.skeleton, warnings: [], summary: undefined };
  }

  const catchphrases: ReadonlyMap<string, readonly string[]> = characterCatchphrases(
    input.characters,
  );
  const speechToOthers: ReadonlyMap<string, readonly string[]> = characterSpeechToOthers(
    input.characters,
  );
  const validateAgainstSkeleton = (polished: string): SectionViolation[] =>
    validatePolishedSkeleton({
      skeleton: input.skeleton,
      polished,
      characters: input.characters,
      lengthLimit: input.skeleton.length * input.tuning.polishLengthLimitRatio,
      tuning: input.tuning,
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
    attempt < input.tuning.polishRetryLimit && pending.length > 0;
    attempt += 1
  ) {
    const failing: string[] = [];

    for (const [position, name] of pending.entries()) {
      input.onProgress?.('polishDialogue', position + 1, pending.length);
      const retryReasons: string[] | undefined = rejected
        .get(name)
        ?.map((violation) => violation.detail);
      const response: SceneDialoguePolishResult = await input.aiService.polishSceneDialogue(
        {
          numberedSkeleton: numbered.text,
          character: {
            name,
            persona: input.personas.get(name) ?? '',
            catchphrases: catchphrases.get(name) ?? [],
            samples: input.voiceSamples.get(name) ?? [],
            knowledge: input.characterKnowledge?.get(name) ?? [],
            speechToOthers: speechToOthers.get(name) ?? [],
            relationChanges: input.characterRelations?.get(name) ?? [],
          },
          otherCharacters: speakers.filter((other) => other !== name),
          otherVoices: otherVoices(input.characters, name),
          ...(retryReasons === undefined ? {} : { retryReasons }),
        },
        input.options,
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
        skeleton: input.skeleton,
        lines,
        characters: input.characters,
        tuning: input.tuning,
      });
      const kept: SceneDialogueRewrite[] = response.rewrites.filter(
        (rewrite) => !lineViolations.has(rewrite.index),
      );
      const solo: DialogueRewriteMerge = mergeDialogueRewrites(
        input.skeleton,
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

  const merged: DialogueRewriteMerge = mergeDialogueRewrites(input.skeleton, numbered, accepted);
  const combinedViolations: SectionViolation[] = validateAgainstSkeleton(merged.text);

  if (combinedViolations.length > 0) {
    return {
      text: input.skeleton,
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

export class PolishDialogueStage implements ISceneStage {
  public readonly id: SceneStageId = 'polishDialogue';

  public async run(run: SceneGenerationRun): Promise<void> {
    const polished: DialoguePolishOutcome = await polishDialogueOrKeepSkeleton({
      aiService: run.aiService,
      skeleton: run.skeleton,
      personas: run.personasUsed,
      voiceSamples: run.voiceSamples,
      characterKnowledge: run.input.characterKnowledge,
      characterRelations: run.input.characterRelations,
      characters: run.context.characters,
      onProgress: run.onProgress,
      options: withAttribution(
        {
          ...buildGenerateOptions(run.providers, 'sceneDialoguePolish'),
          styleDirective: run.styleDirective,
        },
        { primary: run.sceneRef },
      ),
      tuning: run.tuning,
    });
    run.polishedText = polished.text;
    run.dialoguePolish = polished.summary;
    run.warnings.push(...polished.warnings);
    assertNotCancelled(run.shouldCancel);
  }
}
