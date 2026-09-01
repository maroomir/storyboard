import type { StoryUri } from '@storyboard/story-format';
import type { IStoryboardLogger } from '#engine/ports/logger';
import {
  buildCardRecommendations,
  type CardRecommendationAiService,
  type RecommendationSource,
  type RecommendedCard,
} from '#engine/ai/cardRecommendationBuilder';
import type { RecommendationCategory } from '@storyboard/story-ai';

export interface ICardRecommendationRepository {
  load(workspaceRoot: StoryUri, category: RecommendationCategory): Promise<CardRecommendationInput>;
}

export interface ICardRecommendationAiGateway {
  createService(workspaceRoot: StoryUri): CardRecommendationAiService;
}

export type CardRecommendationInput = {
  readonly existingNames: readonly string[];
  readonly sources: readonly RecommendationSource[];
};

export type RecommendCardsRequest = {
  readonly category: RecommendationCategory;
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

export class RecommendCardsUseCase {
  public constructor(
    private readonly aiGateway: ICardRecommendationAiGateway,
    private readonly logger: IStoryboardLogger,
    private readonly repository: ICardRecommendationRepository,
  ) {}

  public async execute(request: RecommendCardsRequest): Promise<RecommendCardsResult> {
    if (request.shouldCancel?.()) {
      return { kind: 'cancelled', ok: false };
    }

    try {
      const input = await this.repository.load(request.workspaceRoot, request.category);

      if (input.sources.length === 0) {
        return { kind: 'no_sources', ok: true };
      }

      const recommendations = await buildCardRecommendations({
        category: request.category,
        sources: input.sources,
        existingNames: input.existingNames,
        aiService: this.aiGateway.createService(request.workspaceRoot),
      });

      if (request.shouldCancel?.()) {
        return { kind: 'cancelled', ok: false };
      }

      return { kind: 'recommended', ok: true, recommendations };
    } catch (error) {
      this.logger.error('Card recommendation failed', error);

      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : '카드 추천에 실패했습니다.',
        ok: false,
      };
    }
  }
}
