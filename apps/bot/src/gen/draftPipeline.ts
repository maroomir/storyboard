import { STORYBOARD_RELATIVE_PATHS, draftRelativePath } from '@storyboard/story-format';

import type { ContentService } from '../content/contentService';
import type { MutateOutcome } from '../workspace/workspaceChanges';
import type { WorkspaceStore } from '../workspace/workspaceStore';
import type { IPipeline, PipelineContext } from './pipelineRunner';
import type { GenJob, PipelineResult } from './types';

export interface DraftGenerator {
  // Produces the draft body for a scene. Injected so the pipeline stays testable without a provider.
  generate(sceneStem: string, isCancelled: () => boolean): Promise<string>;
}

export interface DraftPipelineOptions {
  readonly store: WorkspaceStore;
  readonly content: ContentService;
  readonly generator: DraftGenerator;
}

// `draft/` is gitignored, so a regenerated draft cannot be recovered from history. Previous versions
// are archived under `.draft/<scene>/` first, matching the extension's keepHistory convention.
export class DraftPipeline implements IPipeline {
  public constructor(private readonly options: DraftPipelineOptions) {}

  public async run(job: GenJob, context: PipelineContext): Promise<PipelineResult> {
    const sceneStem = typeof job.target.scene === 'string' ? job.target.scene : '';
    if (sceneStem.length === 0) {
      return { success: false, failureReason: 'provider_error', errorMessage: '씬이 지정되지 않았습니다.' };
    }

    await context.reportStage('씬 확인');
    const scenes = await this.options.store.listScenes();
    if (!scenes.some((scene) => scene.stem === sceneStem)) {
      // The scene may have been renamed or deleted in Desktop while the job waited in the queue.
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: `씬을 찾을 수 없습니다: ${sceneStem}`,
      };
    }

    await context.reportStage('초안 생성');
    const body = await this.options.generator.generate(sceneStem, context.isCancelled);

    if (context.isCancelled()) {
      return { success: false, failureReason: 'cancelled' };
    }

    await context.reportStage('저장');
    const outcome = await this.options.content.writeDraft(sceneStem, body);

    if (outcome.status === 'blocked' || outcome.status === 'stale') {
      return {
        success: false,
        failureReason: 'provider_error',
        errorMessage: describeFailure(outcome),
      };
    }

    context.log('저장', `${draftRelativePath(sceneStem)} 저장 완료`);
    return { success: true, resultRef: draftRelativePath(sceneStem) };
  }
}

function describeFailure(outcome: MutateOutcome): string {
  if (outcome.status === 'blocked') {
    return outcome.detail;
  }
  if (outcome.status === 'stale') {
    return outcome.files.map((file) => file.relativePath).join(', ');
  }
  return '알 수 없는 실패';
}

export function draftHistoryRelativePath(sceneStem: string, revision: number, stamp: string): string {
  const suffix = String(revision).padStart(2, '0');
  return `${STORYBOARD_RELATIVE_PATHS.draftHistoryDirectory}/${sceneStem}/${stamp}-rev-${suffix}.md`;
}
