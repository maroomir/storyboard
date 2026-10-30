import type {
  IStudioFollowUpRepository,
  IStudioSessionRepository,
  StudioChatRequest,
  StudioChatUseCase,
  StudioContextRepository,
} from '@storyboard/story-engine';
import type { ConfigBridge } from '@storyboard/story-ai';
import type { StudioChatTurn } from '@storyboard/story-model';

export interface StudioManagerDependencies {
  readonly studioChatUseCase: StudioChatUseCase;
  readonly studioContextRepository: StudioContextRepository;
  readonly studioSessionRepository: IStudioSessionRepository;
  readonly studioFollowUpRepository: IStudioFollowUpRepository;
  readonly configBridge: ConfigBridge;
}

export type StudioChatTurnRequest = Omit<StudioChatRequest, 'isValidationEnabled'>;

export class StudioManager {
  public readonly context: StudioContextRepository;
  public readonly sessions: IStudioSessionRepository;
  public readonly followUps: IStudioFollowUpRepository;

  public constructor(private readonly deps: StudioManagerDependencies) {
    this.context = deps.studioContextRepository;
    this.sessions = deps.studioSessionRepository;
    this.followUps = deps.studioFollowUpRepository;
  }

  public chat(request: StudioChatTurnRequest): Promise<readonly StudioChatTurn[]> {
    return this.deps.studioChatUseCase.execute({
      ...request,
      isValidationEnabled: this.deps.configBridge.isStudioValidationEnabled(),
    });
  }
}
