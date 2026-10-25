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
  type NoteConsolidatedLists,
  type NoteConsolidationFailure,
  groupNoteConsolidationTargets,
  selectNoteConsolidationTargets,
  STORYBOARD_RELATIVE_PATHS,
} from '@storyboard/story-model';
import type {
  NoteDocument,
  StoryUri,
  StoryboardCard,
  NoteBundle,
  NoteExtractionResult,
  NoteSynthesis,
  NoteConsolidationTarget,
  NoteConsolidationResult,
  NoteConsolidationOutcome,
} from '@storyboard/story-model';

import type { AiGateway } from '#engine/application/ai/aiGateway';
import type {
  IStoryFeatureRepository,
  StoryFeatureSource,
} from '#engine/application/story/storyFeatureTypes';
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

function describeUnconsolidatedCards(names: readonly string[], reason: string): string {
  return `카드 ${names.join(', ')} 의 목록은 ${reason} 같은 뜻의 항목을 하나로 줄이지 못했습니다.`;
}

function describeExtractionFailure(
  failure: NoteExtractionFailure,
  chunk: readonly NoteDocument[],
  position: string,
): string {
  const [first] = chunk;
  const titles: string =
    chunk.length > 1 ? `${first?.title} 외 ${chunk.length - 1}장` : `${first?.title}`;

  return `노트 묶음 ${position} (${titles})은 ${failureDescriptions[failure]} 아무것도 옮기지 못했습니다.`;
}

export interface CardConsolidation {
  readonly plan: NoteAbsorbPlan;
  readonly warnings: readonly string[];
}

export class PlanNoteAbsorbUseCase implements IUseCase<
  PlanNoteAbsorbRequest,
  PlanNoteAbsorbResult
> {
  public constructor(private readonly deps: PlanNoteAbsorbUseCaseDependencies) {}

  public estimate(bundle: NoteBundle): NoteAbsorbEstimate {
    const { providerId, model } = this.deps.aiGateway.getTaskAiConfig('noteExtraction');
    const workload: NoteAbsorbWorkload = measureNoteAbsorbWorkload(bundle.notes, {
      extractionMaxTokens: NoteExtractionPrompt.config.maxTokens,
      synthesisMaxTokens: NoteSynthesisPrompt.config.maxTokens,
      consolidationMaxTokens: NoteCardConsolidationPrompt.config.maxTokens,
    });
    const costCeilingUsd: number | undefined = computeCostUsd({
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
      await this.deps.noteRepository.loadCandidates(workspaceRoot);

      const source: StoryFeatureSource = await this.deps.storyRepository.load(workspaceRoot);
      const aiService: StoryboardAiService = this.deps.aiGateway.createService(workspaceRoot);
      const knownCards: NoteExtractionKnownCard[] = source.cards.map(toKnownCard);
      const chunks: NoteDocument[][] = groupNotesIntoChunks(bundle.notes);
      const extractions: NoteExtraction[] = [];
      const responses: NoteExtractionResponse[] = [];
      const failureWarnings: string[] = [];

      for (const [index, chunk] of chunks.entries()) {
        const position: string = `${index + 1}/${chunks.length}`;
        this.deps.logger.info(`노트 묶음 ${position} 을 읽는 중입니다.`);

        const extraction: NoteExtractionResult = await aiService.extractNotes(
          chunk,
          listKnownNoteEntities(extractions, knownCards),
        );
        extractions.push(extraction.extraction);
        responses.push({
          chunk: index + 1,
          noteIds: chunk.map((note) => note.id),
          ...(extraction.failure === undefined ? {} : { failure: extraction.failure }),
          text: extraction.responseText,
        });

        if (extraction.failure !== undefined) {
          const warning: string = describeExtractionFailure(extraction.failure, chunk, position);
          this.deps.logger.warn(warning);
          failureWarnings.push(warning);
        }
      }

      await this.deps.noteRepository.saveExtractionResponses(workspaceRoot, responses);

      const responsesHint: string = `모델의 원문 응답은 ${STORYBOARD_RELATIVE_PATHS.noteExtractionResponses} 에 있습니다.`;

      if (failureWarnings.length > 0 && failureWarnings.length === chunks.length) {
        return failedResult(
          new Error(`노트 묶음 ${chunks.length}개를 모두 읽지 못했습니다. ${responsesHint}`),
        );
      }

      const premise: string[] = [
        ...new Set(extractions.flatMap((extraction) => extraction.premise)),
      ];
      const castNames: string[] = extractions
        .flatMap((extraction) => extraction.entities)
        .filter((entity) => entity.type === 'character')
        .map((entity) => entity.name);
      const synthesis: NoteSynthesis =
        premise.length === 0
          ? emptyNoteSynthesis
          : await aiService.synthesizeNotePremise(premise, [...new Set(castNames)]);

      const mergedPlan: NoteAbsorbPlan = buildNoteAbsorbPlan({
        notes: bundle.notes,
        extractions,
        synthesis,
        cards: source.cards,
        scenes: source.scenes,
        scenePrefixDigits: source.project.editor.scenePrefixDigits,
      });
      const consolidation: CardConsolidation = await this.consolidateCards(
        aiService,
        mergedPlan,
        chunks,
        source.cards,
      );
      const plan: NoteAbsorbPlan = consolidation.plan;

      const leadingWarnings: string[] = [
        ...(failureWarnings.length === 0 ? [] : [...failureWarnings, responsesHint]),
        ...consolidation.warnings,
      ];
      const checkedPlan: NoteAbsorbPlan =
        leadingWarnings.length === 0
          ? plan
          : { ...plan, warnings: [...leadingWarnings, ...plan.warnings] };

      await this.deps.noteRepository.savePlan(workspaceRoot, checkedPlan);

      return { ok: true as const, plan: checkedPlan };
    });
  }

  private async consolidateCards(
    aiService: Pick<StoryboardAiService, 'consolidateNoteCards'>,
    plan: NoteAbsorbPlan,
    chunks: readonly (readonly NoteDocument[])[],
    cards: readonly StoryboardCard[],
  ): Promise<CardConsolidation> {
    const chunkByNoteId: Map<string, number> = new Map<string, number>();
    for (const [index, chunk] of chunks.entries()) {
      for (const note of chunk) {
        if (!chunkByNoteId.has(note.id)) {
          chunkByNoteId.set(note.id, index);
        }
      }
    }

    const targets: NoteConsolidationTarget[] = selectNoteConsolidationTargets(
      plan,
      chunkByNoteId,
      cards,
    );
    if (targets.length === 0) {
      return { plan, warnings: [] };
    }

    const requests: NoteConsolidationTarget[][] = groupNoteConsolidationTargets(targets);
    const answers: NoteConsolidatedLists[] = [];
    const warnings: string[] = [];
    this.deps.logger.info(
      `카드 ${targets.length}장의 목록과 별칭을 요청 ${requests.length}개로 정리하는 중입니다.`,
    );

    for (const request of requests) {
      const consolidation: NoteConsolidationResult = await aiService.consolidateNoteCards(request);
      const answeredIds: Set<string> = new Set(
        consolidation.consolidated.map((answer) => answer.cardId),
      );
      const unansweredNames: string[] = request
        .filter((target) => !answeredIds.has(target.cardId))
        .map((target) => target.name);
      answers.push(...consolidation.consolidated);

      if (unansweredNames.length > 0) {
        const reason: string =
          consolidation.failure === undefined
            ? '정리 응답에 빠져'
            : consolidationFailureDescriptions[consolidation.failure];
        warnings.push(describeUnconsolidatedCards(unansweredNames, reason));
      }
    }

    const consolidated: NoteConsolidationOutcome = applyNoteConsolidation(plan, targets, answers);
    warnings.push(...consolidated.warnings);
    warnings.forEach((warning) => this.deps.logger.warn(warning));

    return { plan: consolidated.plan, warnings };
  }
}
