import type {
  StudioChatRequest,
  StudioChatTurn,
  StudioChatUseCase,
} from '@storyboard/story-engine';

export interface StudioManagerDependencies {
  readonly studioChatUseCase: StudioChatUseCase;
}

// The Studio conversation: one turn of the author talking to the agent about a card or scene.
export class StudioManager {
  public constructor(private readonly deps: StudioManagerDependencies) {}

  public chat(request: StudioChatRequest): Promise<readonly StudioChatTurn[]> {
    return this.deps.studioChatUseCase.execute(request);
  }
}
