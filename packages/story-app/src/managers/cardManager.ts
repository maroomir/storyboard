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
  SetCardStatementRequest,
  SetCardStatementResult,
  SetCardStatementUseCase,
  UnsetCardStatementRequest,
  UnsetCardStatementResult,
  UnsetCardStatementUseCase,
  RemoveCardRequest,
  RemoveCardResult,
  RemoveCardUseCase,
  CardPendingChangesDesk,
  CardPendingResult,
  CardPendingApplyReport,
  PendingCardChanges,
  PendingCardSummary,
  ProposeStoryCardTargetsResult,
  CardSessionSummary,
  ElementBundle,
  BundleReading,
} from '@storyboard/story-engine';
import { BackgroundFactConflictStore } from '@storyboard/story-engine';
import {
  BundleFileError,
  backgroundCardPath,
  buildCardView,
  characterCardPath,
  getElementDisplayName,
  type CardView,
  type ElementKind,
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

export type CardViewReading =
  | {
      readonly ok: true;
      readonly view: CardView;
      readonly bundlePath: string;
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly message: string };

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
  readonly setCardStatementUseCase: SetCardStatementUseCase;
  readonly unsetCardStatementUseCase: UnsetCardStatementUseCase;
  readonly removeCardUseCase: RemoveCardUseCase;
  readonly cardPendingChanges: CardPendingChangesDesk;
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

  public setStatement(request: SetCardStatementRequest): Promise<SetCardStatementResult> {
    return this.deps.setCardStatementUseCase.execute(request);
  }

  public unsetStatement(request: UnsetCardStatementRequest): Promise<UnsetCardStatementResult> {
    return this.deps.unsetCardStatementUseCase.execute(request);
  }

  public remove(request: RemoveCardRequest): Promise<RemoveCardResult> {
    return this.deps.removeCardUseCase.execute(request);
  }

  public readBundle(workspaceRoot: StoryUri, slug: string): Promise<ElementBundle | undefined> {
    return this.deps.cards.findBundleBySlug(workspaceRoot, slug);
  }

  public async readView(
    workspaceRoot: StoryUri,
    kind: ElementKind,
    directoryName: string,
  ): Promise<CardViewReading> {
    let reading: BundleReading;
    try {
      reading = await this.deps.cards.readBundleAt(workspaceRoot, kind, directoryName);
    } catch (error) {
      if (error instanceof BundleFileError) {
        return { ok: false, message: error.message };
      }
      throw error;
    }

    const namesById: ReadonlyMap<string, string> = new Map(
      (await this.deps.cards.loadRoster(workspaceRoot)).bundles.map((bundle) => [
        bundle.header.id,
        getElementDisplayName(bundle.header),
      ]),
    );

    return {
      ok: true,
      view: buildCardView(reading.bundle, { nameOf: (elementId) => namesById.get(elementId) }),
      bundlePath: reading.bundle.path,
      warnings: reading.warnings.map((warning) => warning.message),
    };
  }

  public async slugOfElement(workspaceRoot: StoryUri, elementId: string): Promise<string | undefined> {
    return (await this.deps.cards.loadRoster(workspaceRoot)).lookup.slugOf(elementId);
  }

  public listHistory(
    workspaceRoot: StoryUri,
    slug: string,
  ): Promise<CardPendingResult<readonly CardSessionSummary[]>> {
    return this.deps.cardPendingChanges.listHistory(workspaceRoot, slug);
  }

  public listPendingCards(workspaceRoot: StoryUri): Promise<readonly PendingCardSummary[]> {
    return this.deps.cardPendingChanges.listCards(workspaceRoot);
  }

  public listPending(
    workspaceRoot: StoryUri,
    slug: string,
  ): Promise<CardPendingResult<PendingCardChanges>> {
    return this.deps.cardPendingChanges.list(workspaceRoot, slug);
  }

  public applyPending(
    workspaceRoot: StoryUri,
    slug: string,
  ): Promise<CardPendingResult<CardPendingApplyReport>> {
    return this.deps.cardPendingChanges.apply(workspaceRoot, slug);
  }

  public discardPending(
    workspaceRoot: StoryUri,
    slug: string,
  ): Promise<CardPendingResult<{ readonly discarded: number }>> {
    return this.deps.cardPendingChanges.discard(workspaceRoot, slug);
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

  public proposeBuildTargets(
    workspaceRoot: StoryUri,
    targets: readonly StoryCardTarget[],
  ): Promise<ProposeStoryCardTargetsResult> {
    return this.deps.applyStoryProposals.proposeCardTargets(workspaceRoot, targets);
  }

  public hasCurrentBuildSources(snapshots: readonly StoryFileSnapshot[]): Promise<boolean> {
    return this.deps.buildStoryCardsUseCase.hasCurrentSources(snapshots);
  }
}
