import type {
  InterviewAnswerOutcome,
  InterviewCardKind,
  InterviewQuestion,
  InterviewSessionSummary,
  StoryUri,
} from '@storyboard/story-model';

import type {
  InterviewAnswerRequest,
  InterviewConfirmRequest,
  InterviewOpenSession,
  InterviewResumeRequest,
  InterviewSessionRequest,
  InterviewStartRequest,
  InterviewStartResult,
  IQuestionStrategy,
} from '#engine/application/interviews/questionStrategy';
import type { CardRoster, WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';

export interface InterviewSessionProtocolDependencies {
  readonly cards: WorkspaceCards;
  readonly strategies: Readonly<Record<InterviewCardKind, IQuestionStrategy>>;
}

export class InterviewSessionProtocol {
  public constructor(private readonly dependencies: InterviewSessionProtocolDependencies) {}

  public async start(request: InterviewStartRequest): Promise<InterviewStartResult> {
    return await (await this.strategyFor(request.workspaceRoot, request.cardId)).start(request);
  }

  public async findOpenSession(
    request: InterviewResumeRequest,
  ): Promise<InterviewOpenSession | undefined> {
    return await (await this.strategyFor(request.workspaceRoot, request.cardId)).findOpenSession(
      request,
    );
  }

  public async abandon(request: InterviewSessionRequest): Promise<void> {
    await (await this.strategyFor(request.workspaceRoot, request.cardId)).abandon(request);
  }

  public async next(request: InterviewSessionRequest): Promise<InterviewQuestion | undefined> {
    return await (await this.strategyFor(request.workspaceRoot, request.cardId)).next(request);
  }

  public async answer(request: InterviewAnswerRequest): Promise<InterviewAnswerOutcome> {
    return await (await this.strategyFor(request.workspaceRoot, request.cardId)).answer(request);
  }

  public async confirm(request: InterviewConfirmRequest): Promise<void> {
    await (await this.strategyFor(request.workspaceRoot, request.cardId)).confirm(request);
  }

  public async finish(request: InterviewSessionRequest): Promise<InterviewSessionSummary> {
    return await (await this.strategyFor(request.workspaceRoot, request.cardId)).finish(request);
  }

  private async strategyFor(workspaceRoot: StoryUri, cardId: string): Promise<IQuestionStrategy> {
    const roster: CardRoster = await this.dependencies.cards.loadRoster(workspaceRoot);
    const kind: InterviewCardKind =
      roster.lookup.idOf('narrator', cardId) !== undefined
        ? 'narrator'
        : roster.lookup.idOf('background', cardId) !== undefined
          ? 'background'
          : 'character';

    return this.dependencies.strategies[kind];
  }
}
