import type {
  ApplyStoryCardTargetsResult,
  ApplyStoryProposals,
  BuildStoryCardsProposal,
  BuildStoryCardsRequest,
  BuildStoryCardsUseCase,
  CollectCardProposalsRequest,
  CollectCardProposalsUseCase,
  CreateCardUseCase,
  CreateCardRequest,
  CreateCardResult,
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
  StoryCardTarget,
  StoryFileSnapshot,
  IBackgroundFactConflictStore,
} from '@storyboard/story-engine';
import { BackgroundFactConflictStore } from '@storyboard/story-engine';
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
  type BibleSubjectKind,
} from '@storyboard/story-model';

export interface CardReading {
  readonly category: BibleSubjectKind;
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

export class CardManager {
  public readonly sidebar: ICardSidebarRepository;
  public readonly bibleCandidates: IBibleCandidateRepository;

  public constructor(private readonly deps: CardManagerDependencies) {
    this.sidebar = deps.cardSidebarRepository;
    this.bibleCandidates = deps.bibleCandidateRepository;
  }

  public list(workspaceRoot: StoryUri, category: BibleSubjectKind): Promise<SidebarCardSummary[]> {
    return this.sidebar.list(workspaceRoot, category);
  }

  public async read(workspaceRoot: StoryUri, id: string): Promise<CardReading | undefined> {
    const candidates: readonly CardReading['category'][] = ['character', 'background'];

    for (const category of candidates) {
      const uri: StoryUri =
        category === 'character'
          ? characterCardPath(workspaceRoot, id)
          : backgroundCardPath(workspaceRoot, id);

      if (await this.deps.fileSystem.exists(uri)) {
        const text: string = new TextDecoder().decode(await this.deps.fileSystem.readFile(uri));
        return { category, uri, card: parseCard(text) };
      }
    }

    return undefined;
  }

  public async listBackgroundFactConflicts(
    workspaceRoot: StoryUri,
  ): Promise<BackgroundFactConflictReport[]> {
    const store: IBackgroundFactConflictStore = new BackgroundFactConflictStore(
      this.deps.fileSystem,
      getStoryboardProjectPaths(workspaceRoot),
    );
    const reports: BackgroundFactConflictReport[] = [];

    for (const summary of await this.list(workspaceRoot, 'background')) {
      const reading: CardReading | undefined = await this.read(workspaceRoot, summary.id);
      if (reading === undefined || reading.card.type === 'character') {
        continue;
      }

      const conflicts: readonly BackgroundFactConflict[] = (await store.load(reading.card)) ?? [];
      if (conflicts.length > 0) {
        reports.push({ cardId: reading.card.id, name: reading.card.name, conflicts });
      }
    }

    return reports;
  }

  public listNarrators(workspaceRoot: StoryUri): Promise<ReadonlyMap<string, NarratorCard>> {
    return this.deps.narratorCardRepository.list(workspaceRoot);
  }

  public createNarrator(
    workspaceRoot: StoryUri,
    card: NarratorCard,
  ): Promise<CreateNarratorCardResult> {
    return this.deps.narratorCardRepository.create(workspaceRoot, card);
  }

  public removeNarrator(workspaceRoot: StoryUri, id: string): Promise<RemoveNarratorCardResult> {
    return this.deps.narratorCardRepository.remove(workspaceRoot, id);
  }

  public create(request: CreateCardRequest): Promise<CreateCardResult> {
    return this.deps.createCardUseCase.execute(request);
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
