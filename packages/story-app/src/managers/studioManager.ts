import type { StudioChatRequest, StudioChatUseCase } from '@storyboard/story-engine';
import type { StudioChatTurn } from '@storyboard/story-model';

export interface StudioManagerDependencies {
  readonly studioChatUseCase: StudioChatUseCase;
}

export class StudioManager {
  public constructor(private readonly deps: StudioManagerDependencies) {}

  public chat(request: StudioChatRequest): Promise<readonly StudioChatTurn[]> {
    return this.deps.studioChatUseCase.execute(request);
  }
}
