import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import type { BibleSubjectKind, StoryUri } from '@storyboard/story-model';
import type { IUseCase } from '#engine/application/useCase';
import {
  buildCardRecommendations,
  type CardRecommendationAiService,
  type RecommendedCard,
} from '#engine/ai/cardRecommendationBuilder';
import type { CardRecommendationInput } from '#engine/application/cards/cardRepositories';

export interface ICardRecommendationAiGateway {
  createService(workspaceRoot: StoryUri): CardRecommendationAiService;
}

export type RecommendCardsRequest = {
  readonly category: BibleSubjectKind;
  readonly shouldCancel?: () => boolean;
  readonly workspaceRoot: StoryUri;
};

export type RecommendCardsResult =
  | { readonly kind: 'cancelled'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false }
  | { readonly kind: 'no_sources'; readonly ok: true }
  | {
      readonly kind: 'recommended';
      readonly ok: true;
      readonly recommendations: readonly RecommendedCard[];
    };

export class RecommendCardsUseCase implements IUseCase<
  RecommendCardsRequest,
  RecommendCardsResult
> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: RecommendCardsRequest): Promise<RecommendCardsResult> {
    if (request.shouldCancel?.()) {
      return { kind: 'cancelled', ok: false };
    }

    try {
      const input: CardRecommendationInput = await this.repositories.cardRecommendations.load(
        request.workspaceRoot,
        request.category,
      );

      if (input.sources.length === 0) {
        return { kind: 'no_sources', ok: true };
      }

      const recommendations: RecommendedCard[] = await buildCardRecommendations({
        category: request.category,
        sources: input.sources,
        existingNames: input.existingNames,
        aiService: this.ai.gateway.createService(request.workspaceRoot),
      });

      if (request.shouldCancel?.()) {
        return { kind: 'cancelled', ok: false };
      }

      return { kind: 'recommended', ok: true, recommendations };
    } catch (error) {
      this.host.logger.error('Card recommendation failed', error);

      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : '카드 추천에 실패했습니다.',
        ok: false,
      };
    }
  }
}
