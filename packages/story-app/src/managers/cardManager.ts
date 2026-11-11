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
  CreateNarratorCardResult,
  ICardSidebarRepository,
  INarratorCardRepository,
  IFileSystem,
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
  CardCollectRepository,
  WorkspaceCaches,
  WorkspaceCards,
} from '@storyboard/story-engine';
import { BackgroundFactConflictStore } from '@storyboard/story-engine';
import {
  backgroundCardPath,
  characterCardPath,
  type BackgroundFactConflict,
  type CardCollectProposal,
  type NarratorCard,
  type SidebarCardSummary,
  type StoryboardCard,
  type StoryUri,
  type BibleSubjectKind,
  type CharacterRef,
  type RelationListCharacter,
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
  readonly buildStoryCardsUseCase: BuildStoryCardsUseCase;
  readonly applyStoryProposals: ApplyStoryProposals;
  readonly cardSidebarRepository: ICardSidebarRepository;
  readonly narratorCardRepository: INarratorCardRepository;
  readonly cardCollectRepository: CardCollectRepository;
  readonly fileSystem: IFileSystem;
  readonly caches: WorkspaceCaches;
  readonly cards: WorkspaceCards;
}

export class CardManager {
  public readonly sidebar: ICardSidebarRepository;

  public constructor(private readonly deps: CardManagerDependencies) {
    this.sidebar = deps.cardSidebarRepository;
  }

  public list(workspaceRoot: StoryUri, category: BibleSubjectKind): Promise<SidebarCardSummary[]> {
    return this.sidebar.list(workspaceRoot, category);
  }

  public async read(workspaceRoot: StoryUri, id: string): Promise<CardReading | undefined> {
    const card: StoryboardCard | undefined = await this.deps.cards.findCard(workspaceRoot, id);
    if (card === undefined) {
      return undefined;
    }

    const category: CardReading['category'] = card.type === 'character' ? 'character' : 'background';
    const uri: StoryUri =
      category === 'character'
        ? characterCardPath(workspaceRoot, id)
        : backgroundCardPath(workspaceRoot, id);
    return { category, uri, card };
  }

  public async listBackgroundFactConflicts(
    workspaceRoot: StoryUri,
  ): Promise<BackgroundFactConflictReport[]> {
    const store: IBackgroundFactConflictStore = new BackgroundFactConflictStore(
      this.deps.caches,
      workspaceRoot,
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

  public loadCharacterRoster(workspaceRoot: StoryUri): Promise<readonly CharacterRef[]> {
    return this.deps.cardCollectRepository.loadCharacterRoster(workspaceRoot);
  }

  public listRelationCharacters(workspaceRoot: StoryUri): Promise<RelationListCharacter[]> {
    return this.deps.cardCollectRepository.listRelationCharacters(workspaceRoot);
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
