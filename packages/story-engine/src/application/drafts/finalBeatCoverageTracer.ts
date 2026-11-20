import type { AiServices } from '#engine/application/engineServices';
import type { IStoryboardLogger } from '#engine/ports/logger';
import type { StoryboardAiService } from '@storyboard/story-ai';
import {
  extractErrorMessage,
  type DraftGenerationStepId,
  type SceneCoverageIssue,
  type StoryUri,
  type TraceBeatStatus,
} from '@storyboard/story-model';

export interface FinalBeatCoverageRequest {
  readonly workspaceRoot: StoryUri;
  readonly sceneStem: string;
  readonly beats: readonly string[];
  readonly body: string;
  readonly aiService: StoryboardAiService;
}

const finalDraftCoverageRule: string = 'final-draft';

function traceStatusOfBeat(issues: readonly SceneCoverageIssue[], beatNumber: number): TraceBeatStatus {
  const statuses: readonly string[] = issues
    .filter((issue) => issue.index === beatNumber)
    .map((issue) => issue.status);
  if (statuses.includes('missing')) {
    return 'missing';
  }

  return statuses.includes('reversed') ? 'reversed' : 'present';
}

export class FinalBeatCoverageTracer {
  public constructor(
    private readonly ai: AiServices,
    private readonly logger: IStoryboardLogger,
  ) {}

  public async trace(request: FinalBeatCoverageRequest): Promise<void> {
    const { workspaceRoot, sceneStem, beats, body, aiService } = request;
    if (!this.ai.traceRecorder.shouldCheckFinalBeats() || beats.length === 0) {
      return;
    }

    const checkStep: DraftGenerationStepId = 'checkFinalBeats';
    try {
      await this.ai.traceRecorder.runStage(workspaceRoot, checkStep, async () => {
        const issues: readonly SceneCoverageIssue[] = await aiService.checkSceneCoverage(beats, body, {
          providerId: this.ai.gateway.getTaskProvider('sceneCoverage'),
          attribution: { primary: { kind: 'scene', id: sceneStem } },
        });
        await this.ai.traceRecorder.recordEvent(workspaceRoot, {
          kind: 'beats-checked',
          rule: finalDraftCoverageRule,
          beats: beats.map((text, index) => ({
            number: index + 1,
            text,
            status: traceStatusOfBeat(issues, index + 1),
          })),
        });
      });
    } catch (error) {
      this.logger.warn(
        `${sceneStem}: 최종 원고의 비트 확인에 실패했습니다. 원고는 저장됐습니다. (${extractErrorMessage(error)})`,
      );
    }
  }
}
