import type { WorkspaceRepositories } from '#engine/application/engineServices';
import type { StoryUri, StoryboardCard } from '@storyboard/story-model';

export class CreateCardUseCase {
  public constructor(private readonly repositories: WorkspaceRepositories) {}

  public async deriveUniqueId(
    workspaceRoot: StoryUri,
    cardType: StoryboardCard['type'],
    suggestedId: string,
    fallbackId: string,
  ): Promise<string> {
    const base: string = suggestedId === 'new-card' ? fallbackId : suggestedId;
    let candidate: string = base;
    let suffix: number = 2;

    while (await this.repositories.cardWriter.exists(workspaceRoot, cardType, candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }

  public async exists(
    workspaceRoot: StoryUri,
    cardType: StoryboardCard['type'],
    id: string,
  ): Promise<boolean> {
    return await this.repositories.cardWriter.exists(workspaceRoot, cardType, id);
  }

  public async write(workspaceRoot: StoryUri, card: StoryboardCard): Promise<StoryUri> {
    return await this.repositories.cardWriter.write(workspaceRoot, card);
  }
}
