import type { AiGateway } from '../ai/aiGateway';
import {
  buildCardCollectProposals,
  type CollectDraft,
  type CollectRosterEntry,
} from '../../ai/cardCollectBuilder';
import type { StoryboardCard } from '@storyboard/story-format';
import type { StoryUri } from '../../paths/storyUri';
import type { CardCollectProposal } from '../../shared/cardCollect';

export interface ICardCollectRepository {
  loadCharacterRoster(workspaceRoot: StoryUri): Promise<readonly CollectRosterEntry[]>;
  loadDrafts(workspaceRoot: StoryUri): Promise<readonly CollectDraft[]>;
}

export class CollectCardProposalsUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly repository: ICardCollectRepository,
  ) {}

  public async execute(
    workspaceRoot: StoryUri,
    card: StoryboardCard,
  ): Promise<CardCollectProposal[]> {
    const [drafts, characterRoster] = await Promise.all([
      this.repository.loadDrafts(workspaceRoot),
      this.repository.loadCharacterRoster(workspaceRoot),
    ]);

    return await buildCardCollectProposals({
      aiService: this.aiGateway.createService(workspaceRoot),
      card,
      characterRoster,
      drafts,
    });
  }
}
