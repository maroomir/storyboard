import type {
  BuildStoryCardsProposal,
  BuildStoryCardsRequest,
  BuildStoryCardsUseCase,
  CollectCardProposalsRequest,
  CollectCardProposalsUseCase,
  CreateCardUseCase,
  IBibleCandidateRepository,
  ICardSidebarRepository,
  PrepareBibleCandidatePromotionResult,
  PrepareCardCandidatePromotionResult,
  PromoteBibleCandidatesUseCase,
  PromoteCardCandidatesResult,
  PromoteCardCandidatesUseCase,
  RecommendCardsRequest,
  RecommendCardsResult,
  RecommendCardsUseCase,
  StoryFileSnapshot,
} from '@storyboard/story-engine';
import type {
  CardCandidateItem,
  CardCollectProposal,
  BibleFact,
  StoryboardCard,
  StoryUri,
} from '@storyboard/story-model';

export interface CardManagerDependencies {
  readonly createCardUseCase: CreateCardUseCase;
  readonly recommendCardsUseCase: RecommendCardsUseCase;
  readonly collectCardProposalsUseCase: CollectCardProposalsUseCase;
  readonly promoteCardCandidatesUseCase: PromoteCardCandidatesUseCase;
  readonly promoteBibleCandidatesUseCase: PromoteBibleCandidatesUseCase;
  readonly buildStoryCardsUseCase: BuildStoryCardsUseCase;
  readonly cardSidebarRepository: ICardSidebarRepository;
  readonly bibleCandidateRepository: IBibleCandidateRepository;
}

// The story bible's cards and canon: create and list cards, and move what generation proposed
// (card candidates, canon facts, recommendations) into them.
export class CardManager {
  public readonly sidebar: ICardSidebarRepository;
  public readonly bibleCandidates: IBibleCandidateRepository;

  public constructor(private readonly deps: CardManagerDependencies) {
    this.sidebar = deps.cardSidebarRepository;
    this.bibleCandidates = deps.bibleCandidateRepository;
  }

  public deriveUniqueId(
    workspaceRoot: StoryUri,
    cardType: StoryboardCard['type'],
    suggestedId: string,
    fallbackId: string,
  ): Promise<string> {
    return this.deps.createCardUseCase.deriveUniqueId(
      workspaceRoot,
      cardType,
      suggestedId,
      fallbackId,
    );
  }

  public exists(
    workspaceRoot: StoryUri,
    cardType: StoryboardCard['type'],
    id: string,
  ): Promise<boolean> {
    return this.deps.createCardUseCase.exists(workspaceRoot, cardType, id);
  }

  public write(workspaceRoot: StoryUri, card: StoryboardCard): Promise<StoryUri> {
    return this.deps.createCardUseCase.write(workspaceRoot, card);
  }

  public recommend(request: RecommendCardsRequest): Promise<RecommendCardsResult> {
    return this.deps.recommendCardsUseCase.execute(request);
  }

  public collectProposals(request: CollectCardProposalsRequest): Promise<CardCollectProposal[]> {
    return this.deps.collectCardProposalsUseCase.execute(request);
  }

  public prepareCandidatePromotion(
    workspaceRoot: StoryUri,
  ): Promise<PrepareCardCandidatePromotionResult> {
    return this.deps.promoteCardCandidatesUseCase.prepare(workspaceRoot);
  }

  public promoteCandidates(
    workspaceRoot: StoryUri,
    items: readonly CardCandidateItem[],
  ): Promise<PromoteCardCandidatesResult> {
    return this.deps.promoteCardCandidatesUseCase.promote(workspaceRoot, items);
  }

  public prepareBiblePromotion(
    workspaceRoot: StoryUri,
  ): Promise<PrepareBibleCandidatePromotionResult> {
    return this.deps.promoteBibleCandidatesUseCase.prepare(workspaceRoot);
  }

  public promoteBibleFacts(workspaceRoot: StoryUri, facts: readonly BibleFact[]): Promise<void> {
    return this.deps.promoteBibleCandidatesUseCase.promote(workspaceRoot, facts);
  }

  public buildFromScenes(request: BuildStoryCardsRequest): Promise<BuildStoryCardsProposal> {
    return this.deps.buildStoryCardsUseCase.execute(request);
  }

  public hasCurrentBuildSources(snapshots: readonly StoryFileSnapshot[]): Promise<boolean> {
    return this.deps.buildStoryCardsUseCase.hasCurrentSources(snapshots);
  }
}
