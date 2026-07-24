import type * as vscode from 'vscode';

import type { StoryboardCard } from '@storyboard/story-format';

export interface ICardWriterRepository {
  exists(workspaceRoot: vscode.Uri, cardType: StoryboardCard['type'], id: string): Promise<boolean>;
  write(workspaceRoot: vscode.Uri, card: StoryboardCard): Promise<vscode.Uri>;
}

export class CreateCardUseCase {
  public constructor(private readonly repository: ICardWriterRepository) {}

  public async deriveUniqueId(
    workspaceRoot: vscode.Uri,
    cardType: StoryboardCard['type'],
    suggestedId: string,
    fallbackId: string,
  ): Promise<string> {
    const base = suggestedId === 'new-card' ? fallbackId : suggestedId;
    let candidate = base;
    let suffix = 2;

    while (await this.repository.exists(workspaceRoot, cardType, candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  public async exists(
    workspaceRoot: vscode.Uri,
    cardType: StoryboardCard['type'],
    id: string,
  ): Promise<boolean> {
    return await this.repository.exists(workspaceRoot, cardType, id);
  }

  public async write(workspaceRoot: vscode.Uri, card: StoryboardCard): Promise<vscode.Uri> {
    return await this.repository.write(workspaceRoot, card);
  }
}
