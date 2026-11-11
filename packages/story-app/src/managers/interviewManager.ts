import type {
  DescribeInterviewCoverageRequest,
  DescribeInterviewCoverageUseCase,
  InterviewAnswerRequest,
  InterviewConfirmRequest,
  InterviewOpenSession,
  InterviewResumeRequest,
  InterviewSessionRequest,
  InterviewSessionProtocol,
  IInterviewRepository,
  InterviewStartRequest,
  InterviewStartResult,
} from '@storyboard/story-engine';
import type {
  InterviewAxesFile,
  StoryUri,
  InterviewAnswerOutcome,
  InterviewCardCoverage,
  InterviewQuestion,
  InterviewSessionSummary,
} from '@storyboard/story-model';

export interface InterviewManagerDependencies {
  readonly interviewSessionProtocol: InterviewSessionProtocol;
  readonly interviewRepository: IInterviewRepository;
  readonly describeInterviewCoverageUseCase: DescribeInterviewCoverageUseCase;
}

export class InterviewManager {
  public constructor(private readonly deps: InterviewManagerDependencies) {}

  public start(request: InterviewStartRequest): Promise<InterviewStartResult> {
    return this.deps.interviewSessionProtocol.start(request);
  }

  public findOpenSession(request: InterviewResumeRequest): Promise<InterviewOpenSession | undefined> {
    return this.deps.interviewSessionProtocol.findOpenSession(request);
  }

  public abandon(request: InterviewSessionRequest): Promise<void> {
    return this.deps.interviewSessionProtocol.abandon(request);
  }

  public next(request: InterviewSessionRequest): Promise<InterviewQuestion | undefined> {
    return this.deps.interviewSessionProtocol.next(request);
  }

  public answer(request: InterviewAnswerRequest): Promise<InterviewAnswerOutcome> {
    return this.deps.interviewSessionProtocol.answer(request);
  }

  public confirm(request: InterviewConfirmRequest): Promise<void> {
    return this.deps.interviewSessionProtocol.confirm(request);
  }

  public finish(request: InterviewSessionRequest): Promise<InterviewSessionSummary> {
    return this.deps.interviewSessionProtocol.finish(request);
  }

  public describeCoverage(
    request: DescribeInterviewCoverageRequest,
  ): Promise<InterviewCardCoverage[]> {
    return this.deps.describeInterviewCoverageUseCase.execute(request);
  }

  public readAxes(workspaceRoot: StoryUri): Promise<InterviewAxesFile> {
    return this.deps.interviewRepository.loadAxes(workspaceRoot);
  }
}
