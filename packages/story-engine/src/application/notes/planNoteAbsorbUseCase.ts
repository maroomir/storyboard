import {
  NoteCardConsolidationPrompt,
  NoteExtractionPrompt,
  NoteSynthesisPrompt,
  type StoryboardAiService,
  computeCostUsd,
} from '@storyboard/story-ai';
import {
  type AiProviderId,
  applyNoteConsolidation,
  emptyNoteSynthesis,
  type NoteExtraction,
  type NoteExtractionFailure,
  type NoteExtractionKnownCard,
  type NoteExtractionResponse,
  buildNoteAbsorbPlan,
  type NoteAbsorbPlan,
  groupNotesIntoChunks,
  listKnownNoteEntities,
  measureNoteAbsorbWorkload,
  type NoteAbsorbWorkload,
  type NoteConsolidationFailure,
  selectNoteConsolidationTargets,
  STORYBOARD_RELATIVE_PATHS,
} from '@storyboard/story-model';
import type { NoteDocument, StoryUri, StoryboardCard, NoteBundle } from '@storyboard/story-model';

import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { IStoryFeatureRepository } from '#engine/application/story/storyFeatureTypes';
import {
  failedResult,
  runUseCase,
  type IUseCase,
  type UseCaseFailure,
} from '#engine/application/useCase';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { INoteAbsorbRepository } from './noteAbsorbRepository';

export interface NoteAbsorbEstimate extends NoteAbsorbWorkload {
  readonly providerId: AiProviderId;
  readonly model: string;
  // The most the run can cost: estimated input plus every request writing up to its limit.
  // Undefined when the model has no listed price.
  readonly costCeilingUsd?: number;
}

export interface PlanNoteAbsorbRequest {
  readonly workspaceRoot: StoryUri;
  readonly bundle: NoteBundle;
}

export type PlanNoteAbsorbResult =
  | { readonly ok: true; readonly plan: NoteAbsorbPlan }
  | UseCaseFailure;

export interface PlanNoteAbsorbUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly logger: IStoryboardLogger;
  readonly storyRepository: IStoryFeatureRepository;
  readonly noteRepository: INoteAbsorbRepository;
}

function toKnownCard(card: StoryboardCard): NoteExtractionKnownCard {
  return {
    id: card.id,
    type: card.type === 'character' ? 'character' : 'background',
    name: card.name,
    aliases: card.aliases ?? [],
  };
}

const failureDescriptions: Readonly<Record<NoteExtractionFailure, string>> = {
  truncated: '응답이 출력 한도에서 잘려',
  unparsed: '응답에서 정리 결과(JSON)를 찾지 못해',
};

const consolidationFailureDescriptions: Readonly<Record<NoteConsolidationFailure, string>> = {
  truncated: '응답이 출력 한도에서 잘려',
  unparsed: '응답에서 정리 결과(JSON)를 찾지 못해',
};

function describeUnconsolidatedCharacters(names: readonly string[], reason: string): string {
  return `인물 ${names.join(', ')} 의 성격·태그는 ${reason} 같은 뜻의 항목을 하나로 줄이지 못했습니다.`;
}

function describeExtractionFailure(
  failure: NoteExtractionFailure,
  chunk: readonly NoteDocument[],
  position: string,
): string {
  const [first] = chunk;
  const titles = chunk.length > 1 ? `${first?.title} 외 ${chunk.length - 1}장` : `${first?.title}`;

  return `노트 묶음 ${position} (${titles})은 ${failureDescriptions[failure]} 아무것도 옮기지 못했습니다.`;
}

// The paid half of the import: the notes are read by the model, and what comes back is merged into
// one plan. Nothing but the cached plan is written — applying it is a separate verb.
export class PlanNoteAbsorbUseCase implements IUseCase<
  PlanNoteAbsorbRequest,
  PlanNoteAbsorbResult
> {
  public constructor(private readonly deps: PlanNoteAbsorbUseCaseDependencies) {}

  public estimate(bundle: NoteBundle): NoteAbsorbEstimate {
    const { providerId, model } = this.deps.aiGateway.getTaskAiConfig('noteExtraction');
    const workload = measureNoteAbsorbWorkload(bundle.notes, {
      extractionMaxTokens: NoteExtractionPrompt.config.maxTokens,
      synthesisMaxTokens: NoteSynthesisPrompt.config.maxTokens,
      consolidationMaxTokens: NoteCardConsolidationPrompt.config.maxTokens,
    });
    const costCeilingUsd = computeCostUsd({
      providerId,
      model,
      usage: { inputTokens: workload.inputTokens, outputTokens: workload.outputTokenCeiling },
    });

    return {
      ...workload,
      providerId,
      model,
      ...(costCeilingUsd === undefined ? {} : { costCeilingUsd }),
    };
  }

  public async execute(request: PlanNoteAbsorbRequest): Promise<PlanNoteAbsorbResult> {
    const { workspaceRoot, bundle } = request;

    return await runUseCase(this.deps.logger, '노트를 정리하지 못했습니다.', async () => {
      const source = await this.deps.storyRepository.load(workspaceRoot);
      const aiService = this.deps.aiGateway.createService(workspaceRoot);
      const knownCards = source.cards.map(toKnownCard);
      const chunks = groupNotesIntoChunks(bundle.notes);
      const extractions: NoteExtraction[] = [];
      const responses: NoteExtractionResponse[] = [];
      const failureWarnings: string[] = [];

      for (const [index, chunk] of chunks.entries()) {
        const position = `${index + 1}/${chunks.length}`;
        this.deps.logger.info(`노트 묶음 ${position} 을 읽는 중입니다.`);

        const result = await aiService.extractNotes(
          chunk,
          listKnownNoteEntities(extractions, knownCards),
        );
        extractions.push(result.extraction);
        responses.push({
          chunk: index + 1,
          noteIds: chunk.map((note) => note.id),
          ...(result.failure === undefined ? {} : { failure: result.failure }),
          text: result.responseText,
        });

        if (result.failure !== undefined) {
          const warning = describeExtractionFailure(result.failure, chunk, position);
          this.deps.logger.warn(warning);
          failureWarnings.push(warning);
        }
      }

      await this.deps.noteRepository.saveExtractionResponses(workspaceRoot, responses);

      const responsesHint = `모델의 원문 응답은 ${STORYBOARD_RELATIVE_PATHS.noteExtractionResponses} 에 있습니다.`;

      if (failureWarnings.length > 0 && failureWarnings.length === chunks.length) {
        return failedResult(
          new Error(`노트 묶음 ${chunks.length}개를 모두 읽지 못했습니다. ${responsesHint}`),
        );
      }

      const premise = [...new Set(extractions.flatMap((extraction) => extraction.premise))];
      const castNames = extractions
        .flatMap((extraction) => extraction.entities)
        .filter((entity) => entity.type === 'character')
        .map((entity) => entity.name);
      const synthesis =
        premise.length === 0
          ? emptyNoteSynthesis
          : await aiService.synthesizeNotePremise(premise, [...new Set(castNames)]);

      const mergedPlan = buildNoteAbsorbPlan({
        notes: bundle.notes,
        extractions,
        synthesis,
        cards: source.cards,
        scenes: source.scenes,
        scenePrefixDigits: source.project.editor.scenePrefixDigits,
      });
      const consolidation = await this.consolidateCharacters(aiService, mergedPlan, chunks);
      const plan = consolidation.plan;

      const leadingWarnings = [
        ...(failureWarnings.length === 0 ? [] : [...failureWarnings, responsesHint]),
        ...consolidation.warnings,
      ];
      const checkedPlan =
        leadingWarnings.length === 0
          ? plan
          : { ...plan, warnings: [...leadingWarnings, ...plan.warnings] };

      await this.deps.noteRepository.savePlan(workspaceRoot, checkedPlan);

      return { ok: true as const, plan: checkedPlan };
    });
  }

  // Exact repeats are already gone; this asks the model once for the ones worded differently.
  // A failed request keeps the merged lists, so the import goes on with a warning.
  private async consolidateCharacters(
    aiService: Pick<StoryboardAiService, 'consolidateNoteCharacters'>,
    plan: NoteAbsorbPlan,
    chunks: readonly (readonly NoteDocument[])[],
  ): Promise<{ readonly plan: NoteAbsorbPlan; readonly warnings: readonly string[] }> {
    const chunkByNoteId = new Map<string, number>();
    for (const [index, chunk] of chunks.entries()) {
      for (const note of chunk) {
        if (!chunkByNoteId.has(note.id)) {
          chunkByNoteId.set(note.id, index);
        }
      }
    }

    const targets = selectNoteConsolidationTargets(plan, chunkByNoteId);
    if (targets.length === 0) {
      return { plan, warnings: [] };
    }

    this.deps.logger.info(`인물 ${targets.length}명의 성격·태그를 정리하는 중입니다.`);
    const result = await aiService.consolidateNoteCharacters(targets);
    const consolidated = applyNoteConsolidation(plan, targets, result.consolidated);
    const unansweredNames = consolidated.unanswered.map((target) => target.name);

    if (unansweredNames.length === 0) {
      return { plan: consolidated.plan, warnings: [] };
    }

    const reason =
      result.failure === undefined
        ? '정리 응답에 빠져'
        : consolidationFailureDescriptions[result.failure];
    const warning = describeUnconsolidatedCharacters(unansweredNames, reason);
    this.deps.logger.warn(warning);

    return { plan: consolidated.plan, warnings: [warning] };
  }
}
