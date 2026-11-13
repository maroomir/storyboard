import type {
  IFileSystem,
  IStudioFollowUpRepository,
  IStudioSessionRepository,
  StudioChatRequest,
  StudioChatUseCase,
  StudioContextRepository,
  StudioCreateRequest,
  StudioCreateResult,
  StudioCreateUseCase,
  StudioEditRequest,
  StudioEditResult,
  StudioEditUseCase,
  StudioProposalApplier,
  StudioProposalApplyResult,
  StudioProposalPreparation,
} from '@storyboard/story-engine';
import type { ConfigBridge } from '@storyboard/story-ai';
import type { StoryUri, StudioChatTurn, StudioEntity } from '@storyboard/story-model';
import { WorkspaceFormatGuard, type WorkspaceFormatCheck } from '#app/workspaceFormatGuard';

export interface StudioManagerDependencies {
  readonly studioChatUseCase: StudioChatUseCase;
  readonly studioContextRepository: StudioContextRepository;
  readonly studioSessionRepository: IStudioSessionRepository;
  readonly studioFollowUpRepository: IStudioFollowUpRepository;
  readonly studioProposalApplier: StudioProposalApplier;
  readonly studioEditUseCase: StudioEditUseCase;
  readonly studioCreateUseCase: StudioCreateUseCase;
  readonly configBridge: ConfigBridge;
  readonly fileSystem: IFileSystem;
}

export type StudioEditVerbRequest = Omit<StudioEditRequest, 'isValidationEnabled'>;

export type StudioCreateVerbRequest = Omit<StudioCreateRequest, 'isValidationEnabled'>;

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

  public edit(request: StudioEditVerbRequest): Promise<StudioEditResult> {
    return this.deps.studioEditUseCase.execute({
      ...request,
      isValidationEnabled: this.deps.configBridge.isStudioValidationEnabled(),
    });
  }

  public async create(request: StudioCreateVerbRequest): Promise<StudioCreateResult> {
    const format: WorkspaceFormatCheck = await new WorkspaceFormatGuard(this.deps.fileSystem).check(
      request.workspaceRoot,
    );
    if (!format.ok) {
      return { ok: false, kind: 'failed', message: format.error.message };
    }

    return await this.deps.studioCreateUseCase.execute({
      ...request,
      isValidationEnabled: this.deps.configBridge.isStudioValidationEnabled(),
    });
  }

  public prepareProposal(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
    turn: StudioChatTurn,
  ): Promise<StudioProposalPreparation> {
    return this.deps.studioProposalApplier.prepare(workspaceRoot, entity, turn);
  }

  public applyProposal(
    workspaceRoot: StoryUri,
    entity: StudioEntity,
    turn: StudioChatTurn,
  ): Promise<StudioProposalApplyResult> {
    return this.deps.studioProposalApplier.apply(workspaceRoot, entity, turn);
  }
}
