import type {
  DescribeInterviewCoverageRequest,
  DescribeInterviewCoverageUseCase,
  InterviewAnswerRequest,
  InterviewConfirmRequest,
  InterviewOpenSession,
  InterviewResumeRequest,
  InterviewSessionRequest,
  InterviewSessionUseCase,
  InterviewStartRequest,
  InterviewStartResult,
} from '@storyboard/story-engine';
import type {
  InterviewAnswerOutcome,
  InterviewCardCoverage,
  InterviewQuestion,
  InterviewSessionSummary,
} from '@storyboard/story-model';

export interface InterviewManagerDependencies {
  readonly interviewSessionUseCase: InterviewSessionUseCase;
  readonly describeInterviewCoverageUseCase: DescribeInterviewCoverageUseCase;
}

export class InterviewManager {
  public constructor(private readonly deps: InterviewManagerDependencies) {}

  public start(request: InterviewStartRequest): Promise<InterviewStartResult> {
    return this.deps.interviewSessionUseCase.start(request);
  }

  public findOpenSession(request: InterviewResumeRequest): Promise<InterviewOpenSession | undefined> {
    return this.deps.interviewSessionUseCase.findOpenSession(request);
  }

  public abandon(request: InterviewSessionRequest): Promise<void> {
    return this.deps.interviewSessionUseCase.abandon(request);
  }

  public next(request: InterviewSessionRequest): Promise<InterviewQuestion | undefined> {
    return this.deps.interviewSessionUseCase.next(request);
  }

  public answer(request: InterviewAnswerRequest): Promise<InterviewAnswerOutcome> {
    return this.deps.interviewSessionUseCase.answer(request);
  }

  public confirm(request: InterviewConfirmRequest): Promise<void> {
    return this.deps.interviewSessionUseCase.confirm(request);
  }

  public finish(request: InterviewSessionRequest): Promise<InterviewSessionSummary> {
    return this.deps.interviewSessionUseCase.finish(request);
  }

  public describeCoverage(
    request: DescribeInterviewCoverageRequest,
  ): Promise<InterviewCardCoverage[]> {
    return this.deps.describeInterviewCoverageUseCase.execute(request);
  }
}
