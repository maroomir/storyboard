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

interface DialoguePolishContext {
  readonly run: SceneGenerationRun;
  readonly options: GenerateTextOptions;
  readonly numbered: NumberedSkeleton;
  readonly speakers: readonly string[];
  readonly catchphrases: ReadonlyMap<string, readonly string[]>;
  readonly speechToOthers: ReadonlyMap<string, readonly string[]>;
}

interface RewriteJudgement {
  readonly kept: readonly SceneDialogueRewrite[];
  readonly lineViolations: ReadonlyMap<number, readonly SectionViolation[]>;
  readonly sceneViolations: readonly SectionViolation[];
}

class DialoguePolishTally {
  private readonly accepted: Map<string, readonly SceneDialogueRewrite[]> = new Map<
    string,
    readonly SceneDialogueRewrite[]
  >();
  private readonly rejected: Map<string, readonly SectionViolation[]> = new Map<
    string,
    readonly SectionViolation[]
  >();
  private readonly partial: Map<string, PartialRewrites> = new Map<string, PartialRewrites>();
  private readonly truncated: Set<string> = new Set<string>();

  public getRetryReasons(name: string): string[] | undefined {
    return this.rejected.get(name)?.map((violation) => violation.detail);
  }

  public recordTruncation(name: string, isTruncated: boolean): void {
    if (isTruncated) {
      this.truncated.add(name);
    } else {
      this.truncated.delete(name);
    }
  }

  public recordAccepted(name: string, rewrites: readonly SceneDialogueRewrite[]): void {
    this.accepted.set(name, rewrites);
    this.rejected.delete(name);
    this.partial.delete(name);
  }

  public recordRejected(
    name: string,
    violations: readonly SectionViolation[],
    partialRewrites: PartialRewrites | undefined,
  ): void {
    this.rejected.set(name, violations);
    if (partialRewrites === undefined) {
      this.partial.delete(name);
    } else {
      this.partial.set(name, partialRewrites);
    }
  }

  public acceptPartialRewrites(): void {
    for (const [name, kept] of this.partial) {
      this.accepted.set(name, kept.rewrites);
    }
  }

  public getAccepted(): ReadonlyMap<string, readonly SceneDialogueRewrite[]> {
    return this.accepted;
  }

  public describeWarnings(): string[] {
    return [
      ...[...this.rejected.entries()].map(([name, violations]) => {
        const details: string = violations.map((violation) => violation.detail).join(' / ');
        const kept: PartialRewrites | undefined = this.partial.get(name);
        return kept === undefined
          ? `${name}의 대사 다듬기를 되돌렸습니다 — ${details}`
          : `${name}의 대사 ${kept.heldBack}개를 뼈대대로 두었습니다 — ${details}`;
      }),
      ...[...this.truncated]
        .filter((name) => !this.rejected.has(name))
        .map(
          (name) => `${name}의 대사 다듬기 응답이 출력 한도에서 잘려 일부 대사를 손보지 못했습니다`,
        ),
    ];
  }
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

    const context: DialoguePolishContext = {
      run,
      options,
      numbered,
      speakers,
      catchphrases: characterCatchphrases(run.context.characters),
      speechToOthers: characterSpeechToOthers(run.context.characters),
    };
    const tally: DialoguePolishTally = new DialoguePolishTally();

    await this.polishInRounds(context, tally);
    tally.acceptPartialRewrites();

    return this.buildOutcome(context, tally);
  }

  private async polishInRounds(
    context: DialoguePolishContext,
    tally: DialoguePolishTally,
  ): Promise<void> {
    let pending: readonly string[] = context.speakers;

    for (
      let attempt: number = 0;
      attempt < context.run.tuning.polishRetryLimit && pending.length > 0;
      attempt += 1
    ) {
      pending = await this.polishRound(context, tally, pending);
    }
  }

  private async polishRound(
    context: DialoguePolishContext,
    tally: DialoguePolishTally,
    pending: readonly string[],
  ): Promise<string[]> {
    const failing: string[] = [];

    for (const [position, name] of pending.entries()) {
      context.run.onProgress?.('polishDialogue', position + 1, pending.length);
      const isAccepted: boolean = await this.polishSpeaker(context, tally, name);
      if (!isAccepted) {
        failing.push(name);
      }
    }

    return failing;
  }

  private async polishSpeaker(
    context: DialoguePolishContext,
    tally: DialoguePolishTally,
    name: string,
  ): Promise<boolean> {
    const response: SceneDialoguePolishResult = await this.requestPolish(
      context,
      name,
      tally.getRetryReasons(name),
    );
    tally.recordTruncation(name, response.isTruncated);

    const judgement: RewriteJudgement = this.judgeRewrites(context, name, response);
    const violations: SectionViolation[] = [
      ...[...judgement.lineViolations.values()].flat(),
      ...judgement.sceneViolations,
    ];

    if (violations.length === 0) {
      tally.recordAccepted(name, response.rewrites);
      return true;
    }

    tally.recordRejected(
      name,
      violations,
      judgement.sceneViolations.length === 0
        ? { rewrites: judgement.kept, heldBack: judgement.lineViolations.size }
        : undefined,
    );
    return false;
  }

  private requestPolish(
    context: DialoguePolishContext,
    name: string,
    retryReasons: string[] | undefined,
  ): Promise<SceneDialoguePolishResult> {
    const { run }: DialoguePolishContext = context;

    return run.aiService.polishSceneDialogue(
      {
        numberedSkeleton: context.numbered.text,
        character: {
          name,
          persona: run.personasUsed.get(name) ?? '',
          catchphrases: context.catchphrases.get(name) ?? [],
          samples: run.voiceSamples.get(name) ?? [],
          knowledge: run.input.characterKnowledge?.get(name) ?? [],
          speechToOthers: context.speechToOthers.get(name) ?? [],
          relationChanges: run.input.characterRelations?.get(name) ?? [],
        },
        otherCharacters: context.speakers.filter((other) => other !== name),
        otherVoices: otherVoices(run.context.characters, name),
        ...(retryReasons === undefined ? {} : { retryReasons }),
      },
      context.options,
    );
  }

  private judgeRewrites(
    context: DialoguePolishContext,
    name: string,
    response: SceneDialoguePolishResult,
  ): RewriteJudgement {
    const { run, numbered }: DialoguePolishContext = context;
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

    return { kept, lineViolations, sceneViolations: this.validateAgainstSkeleton(run, solo.text) };
  }

  private validateAgainstSkeleton(run: SceneGenerationRun, polished: string): SectionViolation[] {
    return validatePolishedSkeleton({
      skeleton: run.skeleton,
      polished,
      characters: run.context.characters,
      lengthLimit: run.skeleton.length * run.tuning.polishLengthLimitRatio,
      tuning: run.tuning,
    });
  }

  private buildOutcome(
    context: DialoguePolishContext,
    tally: DialoguePolishTally,
  ): DialoguePolishOutcome {
    const { run, numbered }: DialoguePolishContext = context;
    const warnings: string[] = tally.describeWarnings();
    const merged: DialogueRewriteMerge = mergeDialogueRewrites(
      run.skeleton,
      numbered,
      tally.getAccepted(),
    );
    const combinedViolations: SectionViolation[] = this.validateAgainstSkeleton(run, merged.text);

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

    return this.buildPolishedOutcome(numbered, merged, warnings);
  }

  private buildPolishedOutcome(
    numbered: NumberedSkeleton,
    merged: DialogueRewriteMerge,
    warnings: readonly string[],
  ): DialoguePolishOutcome {
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
