import type { CollectDraft } from '#engine/ai/cardCollectBuilder';
import type { RecommendationSource } from '#engine/ai/cardRecommendationBuilder';
import type {
  BibleSubjectKind,
  CharacterRef,
  StoryboardCard,
  StoryUri,
} from '@storyboard/story-model';

export interface ICardCollectRepository {
  loadCharacterRoster(workspaceRoot: StoryUri): Promise<readonly CharacterRef[]>;
  loadDrafts(workspaceRoot: StoryUri): Promise<readonly CollectDraft[]>;
}

export interface ICardWriterRepository {
  exists(workspaceRoot: StoryUri, cardType: StoryboardCard['type'], id: string): Promise<boolean>;
  write(workspaceRoot: StoryUri, card: StoryboardCard): Promise<StoryUri>;
  writeAll(workspaceRoot: StoryUri, cards: readonly StoryboardCard[]): Promise<readonly StoryUri[]>;
}

export interface ICardRecommendationRepository {
  load(workspaceRoot: StoryUri, category: BibleSubjectKind): Promise<CardRecommendationInput>;
}

export type CardRecommendationInput = {
  readonly existingNames: readonly string[];
  readonly sources: readonly RecommendationSource[];
};
