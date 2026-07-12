import type * as vscode from 'vscode';

import type { AiGateway } from '../ai/aiGateway';
import {
  buildCardCollectProposals,
  type CollectDraft,
  type CollectRosterEntry,
} from '../../services/ai/cardCollectBuilder';
import type { StoryboardCard } from '../../shared/card';
import type { CardCollectProposal } from '../../shared/cardCollect';

export interface ICardCollectRepository {
  loadCharacterRoster(workspaceRoot: vscode.Uri): Promise<readonly CollectRosterEntry[]>;
  loadDrafts(workspaceRoot: vscode.Uri): Promise<readonly CollectDraft[]>;
}

export class CollectCardProposalsUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly repository: ICardCollectRepository,
  ) {}

  public async execute(
    workspaceRoot: vscode.Uri,
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
