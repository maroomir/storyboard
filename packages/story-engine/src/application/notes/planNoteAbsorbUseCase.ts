import {
  NoteExtractionPrompt,
  NoteSynthesisPrompt,
  computeCostUsd,
  emptyNoteSynthesis,
  type AiProviderId,
  type NoteExtraction,
  type NoteExtractionKnownCard,
} from '@storyboard/story-ai';
import type { StoryUri, StoryboardCard } from '@storyboard/story-format';

import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { IStoryFeatureRepository } from '#engine/application/story/storyFeatureTypes';
import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
import { buildNoteAbsorbPlan, type NoteAbsorbPlan } from '#engine/domain/notes/noteAbsorbPlan';
import {
  groupNotesIntoChunks,
  measureNoteAbsorbWorkload,
  type NoteAbsorbWorkload,
} from '#engine/domain/notes/noteChunks';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { NoteBundle } from '#engine/shared/noteAbsorb';
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

// The paid half of the import: the notes are read by the model, and what comes back is merged into
// one plan. Nothing but the cached plan is written — applying it is a separate verb.
export class PlanNoteAbsorbUseCase implements IUseCase<PlanNoteAbsorbRequest, PlanNoteAbsorbResult> {
  public constructor(private readonly deps: PlanNoteAbsorbUseCaseDependencies) {}

  public estimate(bundle: NoteBundle): NoteAbsorbEstimate {
    const { providerId, model } = this.deps.aiGateway.getTaskAiConfig('noteExtraction');
    const workload = measureNoteAbsorbWorkload(bundle.notes, {
      extractionMaxTokens: NoteExtractionPrompt.config.maxTokens,
      synthesisMaxTokens: NoteSynthesisPrompt.config.maxTokens,
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

      for (const [index, chunk] of chunks.entries()) {
        this.deps.logger.info(`노트 묶음 ${index + 1}/${chunks.length} 을 읽는 중입니다.`);
        extractions.push(await aiService.extractNotes(chunk, knownCards));
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

      const plan = buildNoteAbsorbPlan({
        notes: bundle.notes,
        extractions,
        synthesis,
        cards: source.cards,
        scenes: source.scenes,
        scenePrefixDigits: source.project.editor.scenePrefixDigits,
      });

      await this.deps.noteRepository.savePlan(workspaceRoot, plan);

      return { ok: true as const, plan };
    });
  }
}
