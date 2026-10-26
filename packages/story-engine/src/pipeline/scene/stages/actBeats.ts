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
import { adoptSkeleton, buildSkeletonContext } from '#engine/pipeline/scene/skeletonDrafting';
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

    const optionsFor = (task: keyof SceneGenerationPipelineTaskProviders): GenerateTextOptions =>
      withAttribution(
        { ...buildGenerateOptions(run.providers, task), styleDirective: run.styleDirective },
        { primary: run.sceneRef },
      );
    const castName: (ref: string) => string = castNameOf(run.context);
    const catchphrases: ReadonlyMap<string, readonly string[]> = characterCatchphrases(
      run.context.characters,
    );
    const speechToOthers: ReadonlyMap<string, readonly string[]> = characterSpeechToOthers(
      run.context.characters,
    );
    const notes: Map<string, readonly BeatNote[]> = new Map<string, readonly BeatNote[]>();
    const passages: Map<number, string> = new Map<number, string>();
    const focal: string | undefined = run.styleDirective?.narration?.focal;

    const characterFor = (name: string, beat: ActedBeat): SceneBeatCharacter => ({
      name,
      persona: run.personasUsed.get(name) ?? '',
      catchphrases: catchphrases.get(name) ?? [],
      knowledge: run.input.characterKnowledge?.get(name) ?? [],
      speechToOthers: speechToOthers.get(name) ?? [],
      relationChanges: run.input.characterRelations?.get(name) ?? [],
      notes: liveBeatNotes(notes.get(name) ?? [], beat.number),
      witnessed: witnessedPassages(beats, passages, name),
    });

    const propose = async (
      name: string,
      beat: ActedBeat,
      directive: SceneBeatDirective,
      nextBeats: readonly SceneBeatDirective[],
    ): Promise<SceneBeatProposal | undefined> => {
      const request: BeatActorRequest = {
        character: characterFor(name, beat),
        beat: directive,
        nextBeats,
      };
      const caps: ActorLineCaps = {
        lineMaxChars: run.tuning.actorLineMaxChars,
        lineMaxSentences: run.tuning.actorLineMaxSentences,
      };
      const first: SceneBeatProposal | undefined = await run.aiService.proposeBeatAction(
        { ...request, ...caps },
        optionsFor('sceneBeatActor'),
      );
      const overlongLines: string[] =
        first === undefined
          ? []
          : findOverlongLines(first, caps.lineMaxChars, caps.lineMaxSentences);

      if (first !== undefined && overlongLines.length === 0) {
        return first;
      }

      const second: SceneBeatProposal | undefined = await run.aiService.proposeBeatAction(
        { ...request, ...caps, overlongLines },
        optionsFor('sceneBeatActor'),
      );
      return second ?? first;
    };

    for (const [index, beat] of beats.entries()) {
      run.onProgress?.('actBeats', index + 1, beats.length);
      const directive: SceneBeatDirective = toBeatDirective(beat, sourceBeats[index], castName);
      const nextBeats: SceneBeatDirective[] = nextActedBeats(beats, index).map((next) =>
        toBeatDirective(next, sourceBeats[next.number - 1], castName),
      );
      const isLast: boolean = index === beats.length - 1;

      const proposals: CastProposal[] = await Promise.all(
        beat.cast.map(
          async (name): Promise<CastProposal> => ({
            name,
            proposal: await propose(name, beat, directive, nextBeats),
          }),
        ),
      );
      const arbitrate = (retryReasons?: readonly string[]): Promise<SceneBeatPassage> =>
        run.aiService.arbitrateBeat(
          {
            beat: directive,
            nextBeats,
            proposals,
            priorPassages: priorPassages(beats, passages),
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
          optionsFor('sceneBeatArbiter'),
        );
      const judge = (passage: string): Promise<SceneBeatVerdict | undefined> =>
        run.aiService.judgeBeat(
          {
            characters: beat.cast.map((name) => characterFor(name, beat)),
            beat: directive,
            nextBeats,
            previousPassages: previousPassagesForJudge(beats, passages, beat.number),
            passage,
          },
          optionsFor('sceneBeatJudge'),
        );
      const review = async (passage: string): Promise<BeatReview> => {
        const verdict: SceneBeatVerdict | undefined = await judge(passage);
        return {
          verdict,
          reasons: beatRetryReasons({
            verdict,
            catchphraseOveruse: findBeatCatchphraseOveruse({
              beat,
              passage,
              catchphrases,
              limit: run.tuning.catchphrasePerBeatLimit,
            }),
          }),
        };
      };

      let merged: SceneBeatPassage = await arbitrate();
      let reviewed: BeatReview = await review(merged.passage);

      for (
        let attempt: number = 0;
        attempt < run.tuning.actorRetryLimit && reviewed.reasons.length > 0;
        attempt += 1
      ) {
        merged = await arbitrate(reviewed.reasons);
        reviewed = await review(merged.passage);
      }

      if (reviewed.reasons.length > 0) {
        run.warnings.push(`배우 뼈대 ${beat.number}번 대목: ${reviewed.reasons.join(' / ')}`);
      }
      for (const score of reviewed.verdict?.scores ?? []) {
        if (shouldNoteScore(score.score) && beat.cast.includes(score.name)) {
          notes.set(score.name, addBeatNote(notes.get(score.name) ?? [], beat.number, score.avoid));
        }
      }

      passages.set(beat.number, merged.passage);
      assertNotCancelled(run.shouldCancel);
    }

    adoptSkeleton(run, assembleActedSkeleton(beats, passages));
  }
}
