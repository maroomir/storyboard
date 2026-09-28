import type { StoryUri } from '@storyboard/story-format';
import type { StoryboardCard } from '@storyboard/story-format';

export interface ICardWriterRepository {
  exists(workspaceRoot: StoryUri, cardType: StoryboardCard['type'], id: string): Promise<boolean>;
  write(workspaceRoot: StoryUri, card: StoryboardCard): Promise<StoryUri>;
}

export interface CreateCardUseCaseDependencies {
  readonly repository: ICardWriterRepository;
}

export class CreateCardUseCase {
  public constructor(private readonly deps: CreateCardUseCaseDependencies) {}

  public async deriveUniqueId(
    workspaceRoot: StoryUri,
    cardType: StoryboardCard['type'],
    suggestedId: string,
    fallbackId: string,
  ): Promise<string> {
    const base = suggestedId === 'new-card' ? fallbackId : suggestedId;
    let candidate = base;
    let suffix = 2;

    while (await this.deps.repository.exists(workspaceRoot, cardType, candidate)) {
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
    return await this.deps.repository.exists(workspaceRoot, cardType, id);
  }

  public async write(workspaceRoot: StoryUri, card: StoryboardCard): Promise<StoryUri> {
    return await this.deps.repository.write(workspaceRoot, card);
  }
}
