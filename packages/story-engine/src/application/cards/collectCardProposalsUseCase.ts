import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { IUseCase } from '#engine/application/useCase';
import {
  buildCardCollectProposals,
  type CollectDraft,
  type CollectRosterEntry,
} from '#engine/ai/cardCollectBuilder';
import type { StoryboardCard, StoryUri, CardCollectProposal } from '@storyboard/story-model';

export interface ICardCollectRepository {
  loadCharacterRoster(workspaceRoot: StoryUri): Promise<readonly CollectRosterEntry[]>;
  loadDrafts(workspaceRoot: StoryUri): Promise<readonly CollectDraft[]>;
}

export interface CollectCardProposalsUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly repository: ICardCollectRepository;
}

export interface CollectCardProposalsRequest {
  readonly workspaceRoot: StoryUri;
  readonly card: StoryboardCard;
}

export class CollectCardProposalsUseCase implements IUseCase<
  CollectCardProposalsRequest,
  CardCollectProposal[]
> {
  public constructor(private readonly deps: CollectCardProposalsUseCaseDependencies) {}

  public async execute(request: CollectCardProposalsRequest): Promise<CardCollectProposal[]> {
    const { workspaceRoot, card } = request;
    const [drafts, characterRoster] = await Promise.all([
      this.deps.repository.loadDrafts(workspaceRoot),
      this.deps.repository.loadCharacterRoster(workspaceRoot),
    ]);

    return await buildCardCollectProposals({
      aiService: this.deps.aiGateway.createService(workspaceRoot),
      card,
      characterRoster,
      drafts,
    });
  }
}
