import { draftRelativePath } from '@storyboard/story-format';

import type { ContentService } from '@/content/contentService';
import type { MutateOutcome } from '@/workspace/workspaceChanges';
import type { WorkspaceStore } from '@/workspace/workspaceStore';
import type { IPipeline, PipelineContext } from './pipelineRunner';
import type { GenJob, PipelineResult } from './types';

export interface DraftRevisionReport {
  readonly outcome: MutateOutcome | undefined;
  // The loop revised, then refused its own candidate on safety grounds and kept the original. The
  // file is untouched, so reporting the revision count alone would claim a change that never landed.
  readonly preservedOriginal: boolean;
  readonly passed: boolean;
  readonly revisionCount: number;
  readonly remainingBlocking: number;
  readonly cancelled: boolean;
}

export interface DraftReviser {
  // Runs the shared review→revise loop over the draft on disk, writing it back through the content
  // service when it changed. Injected so the pipeline stays testable without a provider.
  revise(
    sceneStem: string,
    draftBody: string,
    isCancelled: () => boolean,
  ): Promise<DraftRevisionReport>;
}

export interface ReviewPipelineOptions {
  readonly store: WorkspaceStore;
  readonly content: ContentService;
  readonly reviser: DraftReviser;
}

// UC-06: review an existing draft without regenerating it. A clean pass leaves the file untouched;
// a revision is written through the same archive-then-write path a fresh generation uses.
export class ReviewPipeline implements IPipeline {
  public constructor(private readonly options: ReviewPipelineOptions) {}

  public async run(job: GenJob, context: PipelineContext): Promise<PipelineResult> {
    const sceneStem = typeof job.target.scene === 'string' ? job.target.scene : '';
    if (sceneStem.length === 0) {
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: '씬이 지정되지 않았습니다.',
      };
    }

    await context.reportStage('초안 확인');
    const draft = await this.options.store.readDraft(sceneStem);
    if (draft === undefined) {
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: `검수할 초안이 없습니다: ${sceneStem} (/draft ${sceneStem} 로 먼저 생성)`,
      };
    }

    await context.reportStage('검수·수정');
    const report = await this.options.reviser.revise(sceneStem, draft.value, context.isCancelled);

    if (context.isCancelled() || report.cancelled) {
      return { success: false, failureReason: 'cancelled' };
    }

    // A clean pass rewrites nothing, so there is no outcome to inspect.
    if (report.preservedOriginal) {
      context.log('검수', '재작성 결과가 안전 기준을 통과하지 않아 원본을 유지했습니다.');
      return { success: true, resultRef: draftRelativePath(sceneStem) };
    }

    if (report.revisionCount === 0) {
      context.log(
        '검수',
        report.passed
          ? '수정 없이 통과했습니다.'
          : `미해결 blocking 이슈 ${report.remainingBlocking}건`,
      );
      return { success: true, resultRef: draftRelativePath(sceneStem) };
    }

    const outcome = report.outcome;
    if (outcome !== undefined && (outcome.status === 'blocked' || outcome.status === 'stale')) {
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: '검수 결과를 저장하지 못했습니다 (동시 편집 감지).',
      };
    }

    context.log(
      '검수',
      `수정 ${report.revisionCount}회 반영${report.remainingBlocking > 0 ? `, 미해결 ${report.remainingBlocking}건` : ''}`,
    );
    return { success: true, resultRef: draftRelativePath(sceneStem) };
  }
}
