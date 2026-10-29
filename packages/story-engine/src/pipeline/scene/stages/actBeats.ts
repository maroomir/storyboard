import {
  addBeatNote,
  assembleActedSkeleton,
  beatRetryReasons,
  findBeatCatchphraseOveruse,
  findOverlongLines,
  liveBeatNotes,
  nextActedBeats,
  planActedBeats,
  previousPassagesForJudge,
  priorPassages,
  shouldNoteScore,
  toBeatDirective,
  witnessedPassages,
  type ActedBeat,
  type BeatNote,
} from '#engine/pipeline/beatActors';
import { characterSpeechToOthers } from '#engine/pipeline/scene/characterVoices';
import { castNameOf, type SceneGenerationRun } from '#engine/pipeline/scene/sceneGenerationRun';
import type { ISceneStage } from '#engine/pipeline/scene/sceneStage';
import { buildSkeletonContext } from '#engine/pipeline/scene/skeletonChecks';
import { SkeletonDrafter } from '#engine/pipeline/scene/skeletonDrafter';
import { DraftSkeletonStage } from '#engine/pipeline/scene/stages/draftSkeleton';
import {
  assertNotCancelled,
  buildGenerateOptions,
  withAttribution,
} from '#engine/pipeline/sceneGenerationStages';
import type { SceneGenerationPipelineTaskProviders } from '#engine/pipeline/sceneGenerationTypes';
import type { SceneStageId } from '#engine/pipeline/sceneStageCatalog';
import {
  characterCatchphrases,
  type GenerateTextOptions,
  type SceneBeatCharacter,
  type SceneBeatDirective,
  type SceneBeatPassage,
  type SceneBeatProposal,
  type SceneBeatVerdict,
} from '@storyboard/story-ai';
import type { SceneBeat } from '@storyboard/story-model';

export interface ActorLineCaps {
  readonly lineMaxChars: number;
  readonly lineMaxSentences: number;
}

export interface BeatActorRequest {
  readonly character: SceneBeatCharacter;
  readonly beat: SceneBeatDirective;
  readonly nextBeats: readonly SceneBeatDirective[];
}

export interface BeatReview {
  readonly verdict: SceneBeatVerdict | undefined;
  readonly reasons: string[];
}

export interface CastProposal {
  readonly name: string;
  readonly proposal: SceneBeatProposal | undefined;
}

interface BeatTurn {
  readonly beat: ActedBeat;
  readonly directive: SceneBeatDirective;
  readonly nextBeats: readonly SceneBeatDirective[];
  readonly isLast: boolean;
}

interface ReviewedBeatPassage {
  readonly merged: SceneBeatPassage;
  readonly reviewed: BeatReview;
}

class BeatActingSession {
  private readonly castName: (ref: string) => string;
  private readonly catchphrases: ReadonlyMap<string, readonly string[]>;
  private readonly speechToOthers: ReadonlyMap<string, readonly string[]>;
  private readonly notes: Map<string, readonly BeatNote[]> = new Map<string, readonly BeatNote[]>();
  private readonly passages: Map<number, string> = new Map<number, string>();
  private readonly focal: string | undefined;

  public constructor(
    private readonly run: SceneGenerationRun,
    private readonly sourceBeats: readonly SceneBeat[],
    private readonly beats: readonly ActedBeat[],
  ) {
    this.castName = castNameOf(run.context);
    this.catchphrases = characterCatchphrases(run.context.characters);
    this.speechToOthers = characterSpeechToOthers(run.context.characters);
    this.focal = run.styleDirective?.narration?.focal;
  }

  public async actAllBeats(): Promise<void> {
    for (const [index, beat] of this.beats.entries()) {
      await this.actBeat(index, beat);
    }

    new SkeletonDrafter(this.run).adopt(assembleActedSkeleton(this.beats, this.passages));
  }

  private async actBeat(index: number, beat: ActedBeat): Promise<void> {
    this.run.onProgress?.('actBeats', index + 1, this.beats.length);
    const turn: BeatTurn = this.createTurn(index, beat);

    const proposals: CastProposal[] = await Promise.all(
      beat.cast.map(
        async (name): Promise<CastProposal> => ({
          name,
          proposal: await this.propose(name, turn),
        }),
      ),
    );
    const { merged, reviewed }: ReviewedBeatPassage = await this.arbitrateUntilAccepted(
      turn,
      proposals,
    );

    this.recordReview(beat, reviewed);
    this.passages.set(beat.number, merged.passage);
    assertNotCancelled(this.run.shouldCancel);
  }

  private createTurn(index: number, beat: ActedBeat): BeatTurn {
    const directive: SceneBeatDirective = toBeatDirective(
      beat,
      this.sourceBeats[index],
      this.castName,
    );
    const nextBeats: SceneBeatDirective[] = nextActedBeats(this.beats, index).map((next) =>
      toBeatDirective(next, this.sourceBeats[next.number - 1], this.castName),
    );
    const isLast: boolean = index === this.beats.length - 1;

    return { beat, directive, nextBeats, isLast };
  }

  private optionsFor(task: keyof SceneGenerationPipelineTaskProviders): GenerateTextOptions {
    return withAttribution(
      {
        ...buildGenerateOptions(this.run.providers, task),
        styleDirective: this.run.styleDirective,
      },
      { primary: this.run.sceneRef },
    );
  }

  private characterFor(name: string, beat: ActedBeat): SceneBeatCharacter {
    const { run } = this;

    return {
      name,
      persona: run.personasUsed.get(name) ?? '',
      catchphrases: this.catchphrases.get(name) ?? [],
      knowledge: run.input.characterKnowledge?.get(name) ?? [],
      speechToOthers: this.speechToOthers.get(name) ?? [],
      relationChanges: run.input.characterRelations?.get(name) ?? [],
      notes: liveBeatNotes(this.notes.get(name) ?? [], beat.number),
      witnessed: witnessedPassages(this.beats, this.passages, name),
    };
  }

  private async propose(name: string, turn: BeatTurn): Promise<SceneBeatProposal | undefined> {
    const request: BeatActorRequest = {
      character: this.characterFor(name, turn.beat),
      beat: turn.directive,
      nextBeats: turn.nextBeats,
    };
    const caps: ActorLineCaps = {
      lineMaxChars: this.run.tuning.actorLineMaxChars,
      lineMaxSentences: this.run.tuning.actorLineMaxSentences,
    };
    const first: SceneBeatProposal | undefined = await this.run.aiService.proposeBeatAction(
      { ...request, ...caps },
      this.optionsFor('sceneBeatActor'),
    );
    const overlongLines: string[] =
      first === undefined ? [] : findOverlongLines(first, caps.lineMaxChars, caps.lineMaxSentences);

    if (first !== undefined && overlongLines.length === 0) {
      return first;
    }

    const second: SceneBeatProposal | undefined = await this.run.aiService.proposeBeatAction(
      { ...request, ...caps, overlongLines },
      this.optionsFor('sceneBeatActor'),
    );
    return second ?? first;
  }

  private async arbitrateUntilAccepted(
    turn: BeatTurn,
    proposals: readonly CastProposal[],
  ): Promise<ReviewedBeatPassage> {
    let merged: SceneBeatPassage = await this.arbitrate(turn, proposals);
    let reviewed: BeatReview = await this.review(turn, merged.passage);

    for (
      let attempt: number = 0;
      attempt < this.run.tuning.actorRetryLimit && reviewed.reasons.length > 0;
      attempt += 1
    ) {
      merged = await this.arbitrate(turn, proposals, reviewed.reasons);
      reviewed = await this.review(turn, merged.passage);
    }

    return { merged, reviewed };
  }

  private arbitrate(
    turn: BeatTurn,
    proposals: readonly CastProposal[],
    retryReasons?: readonly string[],
  ): Promise<SceneBeatPassage> {
    const { run, focal } = this;
    const { beat, isLast } = turn;

    return run.aiService.arbitrateBeat(
      {
        beat: turn.directive,
        nextBeats: turn.nextBeats,
        proposals,
        priorPassages: priorPassages(this.beats, this.passages),
        grounding: run.context.scene.frontmatter.grounding,
        ...(run.design.length > 0 ? { design: run.design } : {}),
        previousContext: buildSkeletonContext(
          run.condensedPreviousContext,
          run.input.canonFactLines,
        ),
        ...(focal !== undefined && beat.cast.includes(focal) ? { innerCharacter: focal } : {}),
        catchphraseLimit: run.tuning.catchphrasePerBeatLimit,
        ...(isLast ? { endState: run.context.scene.card?.endState } : {}),
        ...(retryReasons === undefined ? {} : { retryReasons }),
      },
      this.optionsFor('sceneBeatArbiter'),
    );
  }

  private judge(turn: BeatTurn, passage: string): Promise<SceneBeatVerdict | undefined> {
    const { beat } = turn;

    return this.run.aiService.judgeBeat(
      {
        characters: beat.cast.map((name) => this.characterFor(name, beat)),
        beat: turn.directive,
        nextBeats: turn.nextBeats,
        previousPassages: previousPassagesForJudge(this.beats, this.passages, beat.number),
        passage,
      },
      this.optionsFor('sceneBeatJudge'),
    );
  }

  private async review(turn: BeatTurn, passage: string): Promise<BeatReview> {
    const verdict: SceneBeatVerdict | undefined = await this.judge(turn, passage);
    return {
      verdict,
      reasons: beatRetryReasons({
        verdict,
        catchphraseOveruse: findBeatCatchphraseOveruse({
          beat: turn.beat,
          passage,
          catchphrases: this.catchphrases,
          limit: this.run.tuning.catchphrasePerBeatLimit,
        }),
      }),
    };
  }

  private recordReview(beat: ActedBeat, reviewed: BeatReview): void {
    if (reviewed.reasons.length > 0) {
      this.run.warnings.push(`배우 뼈대 ${beat.number}번 대목: ${reviewed.reasons.join(' / ')}`);
    }
    for (const score of reviewed.verdict?.scores ?? []) {
      if (shouldNoteScore(score.score) && beat.cast.includes(score.name)) {
        this.notes.set(
          score.name,
          addBeatNote(this.notes.get(score.name) ?? [], beat.number, score.avoid),
        );
      }
    }
  }
}

export class ActBeatsStage implements ISceneStage {
  public readonly id: SceneStageId = 'actBeats';

  public async run(run: SceneGenerationRun): Promise<void> {
    const sourceBeats: SceneBeat[] = run.context.scene.card?.beats ?? [];
    const beats: ActedBeat[] = planActedBeats(sourceBeats, run.context.characters);

    if (beats.length === 0) {
      run.warnings.push('배우 뼈대: 씬 카드에 비트가 없어 뼈대 단계로 대신 썼습니다.');
      await new DraftSkeletonStage().run(run);
      return;
    }

    await new BeatActingSession(run, sourceBeats, beats).actAllBeats();
  }
}
