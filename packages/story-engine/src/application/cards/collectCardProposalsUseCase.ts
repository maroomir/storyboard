import type { AiServices, WorkspaceRepositories } from '#engine/application/engineServices';
import type { IUseCase } from '#engine/application/useCase';
import { buildCardCollectProposals } from '#engine/ai/cardCollectBuilder';
import type { StoryboardCard, StoryUri, CardCollectProposal } from '@storyboard/story-model';

export interface CollectCardProposalsRequest {
  readonly workspaceRoot: StoryUri;
  readonly card: StoryboardCard;
}

export class CollectCardProposalsUseCase implements IUseCase<
  CollectCardProposalsRequest,
  CardCollectProposal[]
> {
  public constructor(
    private readonly ai: AiServices,
    private readonly repositories: WorkspaceRepositories,
  ) {}

  public async execute(request: CollectCardProposalsRequest): Promise<CardCollectProposal[]> {
    const { workspaceRoot, card } = request;
    const [drafts, characterRoster] = await Promise.all([
      this.repositories.cardCollect.loadDrafts(workspaceRoot),
      this.repositories.cardCollect.loadCharacterRoster(workspaceRoot),
    ]);

    return await buildCardCollectProposals({
      aiService: this.ai.gateway.createService(workspaceRoot),
      card,
      characterRoster,
      drafts,
    });
  }
}
