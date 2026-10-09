import type {
  ApplyStoryCardTargetsResult,
  ApplyStoryProposals,
  BuildStoryCardsProposal,
  BuildStoryCardsRequest,
  BuildStoryCardsUseCase,
  CollectCardProposalsRequest,
  CollectCardProposalsUseCase,
  CreateCardUseCase,
  IBibleCandidateRepository,
  CreateNarratorCardResult,
  ICardSidebarRepository,
  INarratorCardRepository,
  IFileSystem,
  PrepareBibleCandidatePromotionResult,
  PrepareCardCandidatePromotionResult,
  PromoteBibleCandidatesUseCase,
  PromoteCardCandidatesResult,
  PromoteCardCandidatesUseCase,
  RemoveNarratorCardResult,
  RecommendCardsRequest,
  RecommendCardsResult,
  RecommendCardsUseCase,
  RenameCardRequest,
  RenameCardResult,
  RenameCardUseCase,
  SidebarCardCategory,
  StoryCardTarget,
  StoryFileSnapshot,
} from '@storyboard/story-engine';
import { createBackgroundFactConflictStore } from '@storyboard/story-engine';
import {
  backgroundCardPath,
  characterCardPath,
  getStoryboardProjectPaths,
  parseCard,
  type BackgroundFactConflict,
  type CardCandidateItem,
  type CardCollectProposal,
  type NarratorCard,
  type BibleFact,
  type SidebarCardSummary,
  type StoryboardCard,
  type StoryUri,
} from '@storyboard/story-model';

export interface CardReading {
  readonly category: SidebarCardCategory;
  readonly uri: StoryUri;
  readonly card: StoryboardCard;
}

export interface BackgroundFactConflictReport {
  readonly cardId: string;
  readonly name: string;
  readonly conflicts: readonly BackgroundFactConflict[];
}

export interface CardManagerDependencies {
  readonly createCardUseCase: CreateCardUseCase;
  readonly recommendCardsUseCase: RecommendCardsUseCase;
  readonly renameCardUseCase: RenameCardUseCase;
  readonly collectCardProposalsUseCase: CollectCardProposalsUseCase;
  readonly promoteCardCandidatesUseCase: PromoteCardCandidatesUseCase;
  readonly promoteBibleCandidatesUseCase: PromoteBibleCandidatesUseCase;
  readonly buildStoryCardsUseCase: BuildStoryCardsUseCase;
  readonly applyStoryProposals: ApplyStoryProposals;
  readonly cardSidebarRepository: ICardSidebarRepository;
  readonly narratorCardRepository: INarratorCardRepository;
  readonly bibleCandidateRepository: IBibleCandidateRepository;
  readonly fileSystem: IFileSystem;
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

  public list(
    workspaceRoot: StoryUri,
    category: SidebarCardCategory,
  ): Promise<SidebarCardSummary[]> {
    return this.sidebar.list(workspaceRoot, category);
  }

  // A card by id alone: a character is looked for first, then a background.
  public async read(workspaceRoot: StoryUri, id: string): Promise<CardReading | undefined> {
    const candidates: readonly CardReading['category'][] = ['character', 'background'];

    for (const category of candidates) {
      const uri =
        category === 'character'
          ? characterCardPath(workspaceRoot, id)
          : backgroundCardPath(workspaceRoot, id);

      if (await this.deps.fileSystem.exists(uri)) {
        const text = new TextDecoder().decode(await this.deps.fileSystem.readFile(uri));
        return { category, uri, card: parseCard(text) };
      }
    }

    return undefined;
  }

  // What generation's conflict check found on the background cards as they are now. A card changed
  // since its check, or never checked, has no answer yet; reading costs nothing.
  public async listBackgroundFactConflicts(
    workspaceRoot: StoryUri,
  ): Promise<BackgroundFactConflictReport[]> {
    const store = createBackgroundFactConflictStore(
      this.deps.fileSystem,
      getStoryboardProjectPaths(workspaceRoot),
    );
    const reports: BackgroundFactConflictReport[] = [];

    for (const summary of await this.list(workspaceRoot, 'background')) {
      const reading = await this.read(workspaceRoot, summary.id);
      if (reading === undefined || reading.card.type === 'character') {
        continue;
      }

      const conflicts = (await store.load(reading.card)) ?? [];
      if (conflicts.length > 0) {
        reports.push({ cardId: reading.card.id, name: reading.card.name, conflicts });
      }
    }

    return reports;
  }

  public listNarrators(workspaceRoot: StoryUri): Promise<ReadonlyMap<string, NarratorCard>> {
    return this.deps.narratorCardRepository.list(workspaceRoot);
  }

  // Refuses an id another narrator card already holds rather than overwriting it.
  public createNarrator(
    workspaceRoot: StoryUri,
    card: NarratorCard,
  ): Promise<CreateNarratorCardResult> {
    return this.deps.narratorCardRepository.create(workspaceRoot, card);
  }

  public removeNarrator(workspaceRoot: StoryUri, id: string): Promise<RemoveNarratorCardResult> {
    return this.deps.narratorCardRepository.remove(workspaceRoot, id);
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

  public rename(request: RenameCardRequest): Promise<RenameCardResult> {
    return this.deps.renameCardUseCase.execute(request);
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

  public discardCandidates(
    workspaceRoot: StoryUri,
    cardIds: ReadonlySet<string> | undefined,
  ): Promise<number> {
    return this.deps.promoteCardCandidatesUseCase.discard(workspaceRoot, cardIds);
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

  // Writes every change `buildFromScenes` proposed; new cards with no derivable id are named back.
  public applyBuildTargets(
    workspaceRoot: StoryUri,
    targets: readonly StoryCardTarget[],
  ): Promise<ApplyStoryCardTargetsResult> {
    return this.deps.applyStoryProposals.applyCardTargets(workspaceRoot, targets);
  }

  public hasCurrentBuildSources(snapshots: readonly StoryFileSnapshot[]): Promise<boolean> {
    return this.deps.buildStoryCardsUseCase.hasCurrentSources(snapshots);
  }
}
